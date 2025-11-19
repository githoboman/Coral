# app/services/agents/alerts_agent.py
import os
import json
import re
from datetime import datetime, timedelta
from typing import Dict, List, Optional, TypedDict, Annotated
import asyncio
from dotenv import load_dotenv
from zoneinfo import ZoneInfo
import logging
import sys

# LangChain imports
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage, AIMessage
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser
from pydantic import BaseModel, Field

# LangGraph imports
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver

# Supabase import
from supabase import create_client, Client
import smtplib
from email.mime.text import MIMEText

# Windows-compatible logging setup
os.makedirs('logs', exist_ok=True)
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO,
    handlers=[
        logging.FileHandler('logs/copilot.log', encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Helper function to remove emojis from log messages for Windows compatibility
def log_safe(message):
    """Remove emojis and special characters for safe logging on Windows."""
    if not isinstance(message, str):
        message = str(message)
    import re
    return re.sub(r'[^\w\s\-\.,;:!?()\[\]{}@#$%&*+=<>/\\|`~]', '', message)

# Load environment variables
load_dotenv()

# Constants
HELP_TEXT = """
🤖 **Copilot Help - What I Can Do:**

**📋 Task Management:**
• "Remind me to buy groceries tomorrow"
• "Create a task to call John at 3 PM"
• "List my tasks" or "Show my tasks"
• "Complete task [task_id]"
• "Delete task [task_id]"

**🔥 Multiple Tasks:**
• "Remind me to buy groceries and call mom tomorrow"
• "I need to: 1. Prepare presentation 2. Email client"
• "Call John at 3pm, email Sarah, then finish the presentation"

**🎯 Features:**
• Smart date/time extraction • Priority levels • Recurring reminders
• Auto-generated descriptions • Multiple tasks per message
• **All tasks require confirmation before creation**

Just talk to me naturally! 😊
"""

SUPPORT_TEXT = """🆘 **Support:** Contact our team for help with task management! 🚀"""

# Data models
class TaskExtraction(BaseModel):
    task_name: str = Field(description="Extracted main task title")
    description: Optional[str] = Field(description="Extracted detailed description")
    due_date: Optional[str] = Field(description="Extracted due date in ISO format")
    priority: str = Field(default="medium", description="Extracted priority level")
    is_recurring: bool = Field(default=False, description="Extracted recurring status")
    reminder_times: Optional[List[str]] = Field(default=[], description="Extracted reminder timestamps")
    tags: Optional[List[str]] = Field(default=[], description="Extracted tags/categories")
    needs_clarification: bool = Field(description="Whether clarification is needed")
    clarification_question: Optional[str] = Field(description="Question to ask for clarification")

class MultipleTaskExtraction(BaseModel):
    tasks: List[TaskExtraction] = Field(description="List of extracted tasks")
    needs_clarification: bool = Field(description="Whether clarification is needed for any task")
    clarification_question: Optional[str] = Field(description="Question to ask for clarification")

# HITL Intent Models for AI-native processing
class PatchOp(BaseModel):
    operation: str = Field(description="Type of operation: set_due_date, set_priority, add_tags, remove_tags, rename, set_reminders")
    value: Optional[str] = Field(description="Value for the operation (ISO date, priority level, tag name, etc.)")
    reminder_times: Optional[List[str]] = Field(default=[], description="List of reminder times in ISO format")

class TaskSelection(BaseModel):
    by: str = Field(description="Selection method: index, id, all, or attribute")
    indices: Optional[List[int]] = Field(default=[], description="Task indices (1-based)")
    ids: Optional[List[int]] = Field(default=[], description="Draft IDs")
    attribute_filter: Optional[Dict[str, str]] = Field(default={}, description="Filter by attributes like priority, tag, etc.")

class Intent(BaseModel):
    type: str = Field(description="Intent type: confirm, cancel, or edit")
    certainty: float = Field(description="Confidence level 0-1")
    messages: List[str] = Field(default=[], description="Clarification messages if needed")

class EditIntent(Intent):
    selections: TaskSelection = Field(description="Which tasks to edit")
    operations: List[PatchOp] = Field(description="Operations to perform on selected tasks")

class ConfirmIntent(Intent):
    pass

class CancelIntent(Intent):
    pass

# State definition
class AgentState(TypedDict):
    messages: Annotated[List, "Messages in the conversation"]
    user_id: str
    awaiting_clarification: bool
    clarification_context: Optional[Dict]
    clarification_count: int
    timezone: str
    pending_draft_ids: Optional[List[int]]
    awaiting_hitl_confirmation: bool
    current_step: str
    context: Optional[any]

class DatabaseClient:
    def __init__(self, supabase_client: Client):
        self.supabase = supabase_client

    def execute(self, operation) -> Dict:
        try:
            response = operation.execute()
            logger.info(f"Database operation executed successfully")
            return {"data": response.data, "error": None}
        except Exception as e:
            logger.error(f"Database error: {log_safe(str(e))}")
            return {"data": None, "error": f"❌ Database error: {str(e)}"}

class UnifiedTaskManager:
    def __init__(self, supabase_client: Client):
        self.db = DatabaseClient(supabase_client)
        self.supabase = supabase_client

    def _ensure_user_exists(self, user_id: str, timezone: str) -> bool:
        user_response = self.db.execute(
            self.db.supabase.table('user_profiles').select('timezone').eq('user_id', user_id)
        )
        if user_response["error"]:
            logger.error(f"Failed to check user existence: {log_safe(user_response['error'])}")
            return False

        if not user_response["data"]:
            tz = ZoneInfo(timezone if timezone else 'Africa/Lagos')
            insert_response = self.db.execute(
                self.db.supabase.table('user_profiles').upsert({
                    'user_id': user_id,
                    'username': f"user_{user_id}",
                    'timezone': timezone if timezone else 'Africa/Lagos',
                    'created_at': datetime.now(tz).isoformat()
                }, on_conflict=['user_id'])
            )
            if insert_response["error"]:
                logger.error(f"Failed to create user profile: {log_safe(insert_response['error'])}")
                return False
            logger.info(f"Created user profile for user_id: {user_id}")
            return True

        existing_tz = user_response["data"][0].get('timezone', 'Africa/Lagos')
        if existing_tz != timezone:
            update_response = self.db.execute(
                self.db.supabase.table('user_profiles').update({
                    'timezone': timezone if timezone else 'Africa/Lagos'
                }).eq('user_id', user_id)
            )
            logger.info(f"Updated timezone to {timezone} for user_id: {user_id}")
        return True

    async def create_draft_task(self, user_id: str, task: Dict, timezone: str) -> Dict:
        if not self._ensure_user_exists(user_id, timezone):
            logger.error(f"Failed to ensure user exists for user_id: {user_id}")
            return {"success": False, "message": "❌ Error setting up user profile", "draft_id": None}

        tz = ZoneInfo(timezone)
        task_data = {
            'user_id': user_id,
            'task_name': task.get('task_name', '').strip(),
            'description': task.get('description', '').strip(),
            'due_date': task.get('due_date') or None,
            'priority': task.get('priority', 'medium'),
            'status': 'draft',
            'created_at': datetime.now(tz).isoformat(),
            'is_recurring': task.get('is_recurring', False),
            'reminder_times': task.get('reminder_times', []),
            'tags': task.get('tags', [])
        }

        response = self.db.execute(
            self.db.supabase.table('task_drafts').insert(task_data)
        )
        if response["error"] or not response["data"]:
            logger.error(f"Failed to create draft task: {log_safe(response.get('error', 'Unknown error'))}")
            return {"success": False, "message": response.get("error", "❌ Failed to create draft task"), "draft_id": None}

        draft_task = response["data"][0]
        logger.info(f"Created draft task: {log_safe(draft_task['task_name'])} (ID: {draft_task['id']}) for user_id: {user_id}")
        return {
            "success": True,
            "message": f"Draft task '{task_data['task_name']}' saved for review.",
            "draft_id": draft_task['id'],
            "task_data": draft_task
        }

    async def finalize_draft_tasks(self, user_id: str, draft_ids: List[int], timezone: str, context=None) -> str:
        results = []
        failed = []
        tz = ZoneInfo(timezone)

        for i, draft_id in enumerate(draft_ids, 1):
            draft_response = self.db.execute(
                self.db.supabase.table('task_drafts').select('*').eq('user_id', user_id).eq('id', draft_id)
            )
            if draft_response["error"] or not draft_response["data"]:
                failed.append(f"Task {i}: Draft ID {draft_id} not found")
                logger.error(f"Draft ID {draft_id} not found for user_id: {user_id}")
                continue

            draft_task = draft_response["data"][0]
            task_data = {
                'user_id': user_id,
                'task_name': draft_task['task_name'],
                'description': draft_task['description'],
                'due_date': draft_task['due_date'],
                'priority': draft_task['priority'],
                'status': 'pending',
                'created_at': draft_task['created_at'],
                'is_recurring': draft_task['is_recurring'],
                'reminder_times': draft_task['reminder_times'],
                'tags': draft_task['tags']
            }

            response = self.db.execute(
                self.db.supabase.table('tasks').insert(task_data)
            )
            if response["error"] or not response["data"]:
                failed.append(f"Task {i}: {response.get('error', 'Failed to finalize task')}")
                logger.error(f"Failed to finalize task: {log_safe(response.get('error', 'Unknown error'))}")
                continue

            created_task = response["data"][0]
            task_id = created_task['id']
            logger.info(f"Finalized task: {log_safe(created_task['task_name'])} (ID: {task_id}) for user_id: {user_id}")

            self._create_reminders(created_task, user_id, tz)
            if context:
                await self._handle_notifications(created_task, user_id, tz, context)

            results.append(self._format_task_response(created_task, tz).replace("✅ **Task created!**\n\n", f"{i}. "))

            self.db.execute(
                self.db.supabase.table('task_drafts').delete().eq('user_id', user_id).eq('id', draft_id)
            )
            logger.info(f"Deleted draft task ID: {draft_id} for user_id: {user_id}")

        response = f"📋 **Created {len(results)} task{'s' if len(results) != 1 else ''}:**\n\n" + "\n\n".join(results)
        if failed:
            response += f"\n❌ **Failed:** {len(failed)} task{'s' if len(failed) != 1 else ''}\n" + "\n".join(failed)
        logger.info(f"Finalized {len(results)} tasks, {len(failed)} failed for user_id: {user_id}")
        return response.strip()

    def _create_reminders(self, task: Dict, user_id: str, tz: ZoneInfo):
        for reminder_time in task.get('reminder_times', []):
            reminder_data = {
                'task_id': task['id'],
                'user_id': user_id,
                'reminder_time': reminder_time,
                'reminder_type': 'recurring' if task['is_recurring'] else 'custom',
                'is_sent': False,
                'created_at': datetime.now(tz).isoformat()
            }
            self.db.execute(
                self.db.supabase.table('task_reminders').insert(reminder_data)
            )
            logger.info(f"Created reminder for task ID: {task['id']} at {reminder_time}")

    async def _handle_notifications(self, task: Dict, user_id: str, tz: ZoneInfo, context):
        if hasattr(context, 'job_queue') and context.job_queue and task.get('due_date'):
            due_date = datetime.fromisoformat(task['due_date'])
            if due_date.tzinfo is None:
                due_date = due_date.replace(tzinfo=tz)

            chat_id = context.chat_id if hasattr(context, 'chat_id') else None
            if chat_id:
                context.job_queue.run_once(
                    self._send_reminder_callback,
                    due_date,
                    data={
                        'chat_id': chat_id,
                        'task_name': task['task_name'],
                        'due_date': due_date,
                        'user_id': user_id
                    }
                )
                logger.info(f"Scheduled reminder for task: {log_safe(task['task_name'])} at {due_date}")
        await self._send_confirmation_email(task, user_id)

    async def _send_reminder_callback(self, context):
        data = context.job.data
        await context.bot.send_message(
            chat_id=data['chat_id'],
            text=f"Reminder: {data['task_name']} is due at {data['due_date'].strftime('%Y-%m-%d %H:%M')}!"
        )
        logger.info(f"Sent reminder for task: {log_safe(data['task_name'])} to chat_id: {data['chat_id']}")

    async def _send_confirmation_email(self, task: Dict, user_id: str):
        try:
            user_response = self.db.execute(
                self.db.supabase.table('user_profiles').select('email, is_premium').eq('user_id', user_id)
            )
            if user_response["data"] and user_response["data"][0].get('is_premium') and user_response["data"][0].get('email'):
                email = user_response["data"][0]['email']
                await self._send_email(email, task)
                logger.info(f"Sent confirmation email for task ID: {task['id']} to {email}")
        except Exception as e:
            logger.error(f"Failed to send confirmation email for task ID: {task['id']}: {log_safe(str(e))}")

    async def _send_email(self, email: str, task: Dict):
        EMAIL_USER = os.getenv("EMAIL_USER")
        EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD")
        if not EMAIL_USER or not EMAIL_PASSWORD:
            logger.warning("Email credentials not set, skipping email notification")
            return

        subject = f"New Task: {task['task_name']}"
        due_date_str = f"Due: {datetime.fromisoformat(task['due_date']).strftime('%Y-%m-%d %H:%M')}" if task.get('due_date') else "No due date"

        body = f"""
        <html>
            <body style="font-family: Arial, sans-serif; color: #333;">
                <h2 style="color: #2c3e50;">New Task Confirmation</h2>
                <p>Hi!</p>
                <p>Your task <strong>{task['task_name']}</strong> (ID: <strong>{task['id']}</strong>) has been created!</p>
                <p><span style="color: #e74c3c;">{due_date_str}</span></p>
                <p style="color: #27ae60;">Best,<br>Your Copilot Bot</p>
            </body>
        </html>
        """

        try:
            msg = MIMEText(body, 'html')
            msg['Subject'] = subject
            msg['From'] = EMAIL_USER
            msg['To'] = email

            with smtplib.SMTP('smtp.gmail.com', 587, timeout=10) as server:
                server.starttls()
                server.login(EMAIL_USER, EMAIL_PASSWORD)
                server.send_message(msg)
        except Exception as e:
            logger.error(f"Failed to send email to {email}: {log_safe(str(e))}")

    def _format_task_response(self, task: Dict, tz: ZoneInfo) -> str:
        due_info = f" due on {datetime.fromisoformat(task['due_date']).astimezone(tz).strftime('%Y-%m-%d %H:%M')}" if task.get('due_date') else ""

        reminder_info = ""
        if task.get('reminder_times'):
            times = [datetime.fromisoformat(t).astimezone(tz).strftime('%H:%M') for t in task['reminder_times']]
            reminder_info = f" with reminder{'s' if len(times) > 1 else ''} at {', '.join(times)}"

        tags_info = f"\n🏷️ Tags: {', '.join(task['tags'])}" if task.get('tags') else ""
        return f"✅ **Task created!**\n\n📋 **{task['task_name']}**{due_info}{reminder_info}{tags_info}\n\n📝 {task.get('description', 'No description')}"

    async def list_tasks(self, user_id: str, timezone: str, status: str = "pending") -> str:
        response = self.db.execute(
            self.db.supabase.table('tasks').select('*').eq('user_id', user_id).eq('status', status)
        )
        if response["error"]:
            logger.error(f"Failed to list tasks: {log_safe(response['error'])}")
            return response["error"]

        tasks = response["data"]
        if not tasks:
            return "📝 No tasks yet. Try 'remind me to buy groceries tomorrow'!"

        tz = ZoneInfo(timezone)
        task_list = f"📋 **Your {status.title()} Tasks:**\n\n"
        priority_emoji = {"high": "🔴", "medium": "🟡", "low": "🟢"}

        for task in sorted(tasks, key=lambda x: (x.get('due_date') or "9999-12-31T23:59:59")):
            emoji = priority_emoji.get(task.get('priority', 'medium'), '🟡')
            due_info = f"\n   📅 Due: {datetime.fromisoformat(task['due_date']).astimezone(tz).strftime('%Y-%m-%d %H:%M')}" if task.get('due_date') else ""
            tags_info = f"\n   🏷️ {', '.join(task['tags'])}" if task.get('tags') else ""

            task_list += f"{emoji} **{task['task_name']}** (ID: {task['id']}){due_info}{tags_info}\n"
            if task.get('description'):
                task_list += f"   📝 {task['description']}\n"
            task_list += "\n"

        logger.info(f"Listed {len(tasks)} tasks for user_id: {user_id}")
        return task_list

    async def complete_task(self, user_id: str, task_id: str, timezone: str) -> str:
        tz = ZoneInfo(timezone)
        response = self.db.execute(
            self.db.supabase.table('tasks').update({
                'status': 'completed',
                'updated_at': datetime.now(tz).isoformat()
            }).eq('user_id', user_id).eq('id', task_id)
        )
        if response["error"]:
            logger.error(f"Failed to complete task ID: {task_id}: {log_safe(response['error'])}")
            return response["error"]
        if response["data"]:
            logger.info(f"Completed task: {log_safe(response['data'][0]['task_name'])} (ID: {task_id})")
            return f"🎉 Task **{response['data'][0]['task_name']}** completed!"
        return f"❌ Task ID {task_id} not found"

    async def delete_task(self, user_id: str, task_id: str) -> str:
        task_response = self.db.execute(
            self.db.supabase.table('tasks').select('task_name').eq('user_id', user_id).eq('id', task_id)
        )
        if task_response["error"] or not task_response["data"]:
            logger.error(f"Task ID {task_id} not found for deletion")
            return f"❌ Task ID {task_id} not found"

        self.db.execute(
            self.db.supabase.table('tasks').delete().eq('user_id', user_id).eq('id', task_id)
        )
        logger.info(f"Deleted task: {log_safe(task_response['data'][0]['task_name'])} (ID: {task_id})")
        return f"🗑️ Task **{task_response['data'][0]['task_name']}** deleted"

    async def delete_draft_tasks(self, user_id: str, draft_ids: List[int]) -> str:
        deleted = []
        failed = []

        for i, draft_id in enumerate(draft_ids, 1):
            draft_response = self.db.execute(
                self.db.supabase.table('task_drafts').select('task_name').eq('user_id', user_id).eq('id', draft_id)
            )
            if draft_response["error"] or not draft_response["data"]:
                failed.append(f"Draft {i}: ID {draft_id} not found")
                logger.error(f"Draft ID {draft_id} not found for deletion")
                continue

            self.db.execute(
                self.db.supabase.table('task_drafts').delete().eq('user_id', user_id).eq('id', draft_id)
            )
            deleted.append(f"Draft {i}: {draft_response['data'][0]['task_name']}")
            logger.info(f"Deleted draft task: {log_safe(draft_response['data'][0]['task_name'])} (ID: {draft_id})")

        response = f"🗑️ **Deleted {len(deleted)} draft task{'s' if len(deleted) != 1 else ''}:**\n" + "\n".join(deleted)
        if failed:
            response += f"\n❌ **Failed:** {len(failed)} draft{'s' if len(failed) != 1 else ''}\n" + "\n".join(failed)
        return response.strip()

class TaskExtractor:
    def __init__(self, llm: ChatGoogleGenerativeAI):
        self.llm = llm

    def extract_tasks(self, user_input: str, clarification_count: int, previous_extraction: Optional[Dict], timezone: str) -> Dict:
        tz = ZoneInfo(timezone)

        system_message = f"""
Extract tasks from user input, focusing on the primary task unless multiple tasks are explicitly listed (e.g., 'and', numbered lists). Current time in {timezone}: {datetime.now(tz).isoformat()}
Step: {clarification_count + 1}/4

Rules:
1. Extract ONE primary task unless multiple tasks are clearly specified (e.g., 'task1 and task2', '1. task1 2. task2').
2. For event-related inputs, create a task for organizing the event with details in the description.
3. Generate task_name (3-8 words), description (1-2 sentences incorporating ALL relevant details).
4. Convert dates to ISO format in {timezone} (e.g., 'tomorrow' → next day at 12:00).
5. Set priority: 'urgent'/'now' → high, 'today'/'soon' → medium, else low.
6. Handle special cases: 'in a minute' → high priority + 1min reminder.
7. Generate 1-3 relevant tags based on context.
8. Set needs_clarification if critical info (e.g., date, task scope) is missing.
9. Avoid creating tasks from clarification prompts; refine the previous task if provided.
10. Avoid over-segmenting; consolidate related details into one task unless explicitly separate.

Return JSON with 'tasks' array, 'needs_clarification', 'clarification_question'.
"""

        prompt = ChatPromptTemplate.from_messages([
            ("system", system_message),
            ("human", "Previous: {previous}\nInput: {user_input}")
        ])

        parser = JsonOutputParser(pydantic_object=MultipleTaskExtraction)
        chain = prompt | self.llm | parser

        try:
            if "can you provide more details" in user_input.lower():
                logger.info(f"Skipping task extraction for clarification prompt: {log_safe(user_input)}")
                return previous_extraction or {
                    "tasks": [],
                    "needs_clarification": True,
                    "clarification_question": user_input
                }

            result = chain.invoke({
                "user_input": user_input,
                "previous": json.dumps(previous_extraction) if previous_extraction else "None"
            })

            self._apply_special_cases(result.get("tasks", []), user_input, tz)
            self._ensure_required_fields(result.get("tasks", []), user_input)
            logger.info(f"Extracted {len(result.get('tasks', []))} tasks from input: {log_safe(user_input[:50])}")
            return result
        except Exception as e:
            logger.error(f"Task extraction failed: {log_safe(str(e))}")
            return self._fallback_extraction(user_input, tz, clarification_count)

    def _apply_special_cases(self, tasks: List[Dict], user_input: str, tz: ZoneInfo):
        if "in a minute" in user_input.lower():
            reminder_time = (datetime.now(tz) + timedelta(minutes=1)).replace(microsecond=0).isoformat()
            for task in tasks:
                task.update({
                    "reminder_times": [reminder_time],
                    "due_date": reminder_time,
                    "priority": "high",
                    "is_recurring": False
                })
        elif "twice daily" in user_input.lower():
            tomorrow = datetime.now(tz) + timedelta(days=1)
            reminder_times = [
                tomorrow.replace(hour=10, minute=0, second=0, microsecond=0).isoformat(),
                tomorrow.replace(hour=17, minute=0, second=0, microsecond=0).isoformat()
            ]
            for task in tasks:
                task.update({"is_recurring": True, "reminder_times": reminder_times})

    def _ensure_required_fields(self, tasks: List[Dict], user_input: str):
        for i, task in enumerate(tasks):
            if not task.get("task_name"):
                task["task_name"] = f"Task {i+1}: {user_input[:30]}..."
            if not task.get("description"):
                task["description"] = f"Task created from: '{user_input}'"
            if not task.get("tags"):
                task["tags"] = ["general"]

    def _fallback_extraction(self, user_input: str, tz: ZoneInfo, clarification_count: int) -> Dict:
        task = {
            "task_name": f"Task: {user_input[:30]}...",
            "description": user_input,
            "priority": "medium",
            "is_recurring": False,
            "reminder_times": [],
            "tags": ["general"],
            "due_date": "",
            "needs_clarification": clarification_count < 4,
            "clarification_question": "Could you clarify this task?" if clarification_count < 4 else None
        }

        if "in a minute" in user_input.lower():
            reminder_time = (datetime.now(tz) + timedelta(minutes=1)).replace(microsecond=0).isoformat()
            task.update({
                "reminder_times": [reminder_time],
                "due_date": reminder_time,
                "priority": "high"
            })

        logger.info(f"Fallback extraction for input: {log_safe(user_input[:50])}")
        return {
            "tasks": [task],
            "needs_clarification": task["needs_clarification"],
            "clarification_question": task["clarification_question"]
        }

class ToviraAgent:
    def __init__(self, gemini_api_key: str, supabase_client: Client):
        self.llm = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            google_api_key=gemini_api_key,
            temperature=0.1
        )
        self.task_manager = UnifiedTaskManager(supabase_client)
        self.extractor = TaskExtractor(self.llm)
        self.db = DatabaseClient(supabase_client)
        self.workflow = self._build_graph()
        self.memory = MemorySaver()
        self.app = self.workflow.compile(checkpointer=self.memory)

    def _build_graph(self) -> StateGraph:
        """Build LangGraph workflow with recursion fix."""
        workflow = StateGraph(AgentState)

        workflow.add_node("router", self._route_message)
        workflow.add_node("task_creation", self._handle_task_creation)
        workflow.add_node("task_management", self._handle_task_management)
        workflow.add_node("general_chat", self._handle_general_chat)
        workflow.add_node("clarification", self._handle_clarification)
        workflow.add_node("hitl_confirmation", self._handle_hitl_confirmation)
        workflow.add_node("execute_tasks", self._execute_task_creation)
        workflow.add_node("wait_for_user", self._wait_for_user)  # NEW NODE

        workflow.set_entry_point("router")
        workflow.add_conditional_edges("router", self._route_decision, {
            "task_creation": "task_creation",
            "task_management": "task_management",
            "general_chat": "general_chat",
            "clarification": "clarification",
            "hitl_confirmation": "hitl_confirmation"
        })

        workflow.add_conditional_edges("task_creation", self._task_creation_decision, {
            "wait_for_user": "wait_for_user",  # CHANGED: Go to wait state
            "clarification": "clarification",
            "end": END
        })

        workflow.add_conditional_edges("hitl_confirmation", self._hitl_decision, {
            "execute_tasks": "execute_tasks",
            "clarification": "clarification",
            "wait_for_user": "wait_for_user",  # CHANGED: Go to wait state instead of looping
            "end": END
        })

        workflow.add_conditional_edges("clarification", self._clarification_decision, {
            "wait_for_user": "wait_for_user",  # CHANGED: Go to wait state
            "end": END
        })

        # Wait node goes to END - no more loops
        workflow.add_edge("wait_for_user", END)
        workflow.add_edge("execute_tasks", END)
        workflow.add_edge("task_management", END)
        workflow.add_edge("general_chat", END)
        return workflow


    def _route_message(self, state: AgentState) -> AgentState:
        state["current_step"] = "routing"
        logger.info(f"Routing message for user_id: {state['user_id']}, message_length: {len(state['messages'][-1].content)}")
        return state

    def _route_decision(self, state: AgentState) -> str:
        # Check if we have valid drafts before routing to HITL
        if state.get("awaiting_hitl_confirmation"):
            draft_ids = state.get("pending_draft_ids", [])
            if draft_ids:
                logger.info(f"Routing to hitl_confirmation for user_id: {state['user_id']}")
                return "hitl_confirmation"
            else:
                # Clear stale HITL state if no valid drafts exist
                logger.warning(f"Clearing stale HITL state - no drafts found for user_id: {state['user_id']}")
                self._clear_hitl_state(state)
        
        if state.get("awaiting_clarification"):
            logger.info(f"Routing to clarification for user_id: {state['user_id']}")
            return "clarification"

        message = state["messages"][-1].content.lower()
        creation_patterns = [r"remind me", r"create.*task", r"add.*task", r"schedule", r"need to", r"have to", r"don't forget"]
        if any(re.search(pattern, message) for pattern in creation_patterns):
            logger.info(f"Routing to task_creation for user_id: {state['user_id']}")
            return "task_creation"

        management_patterns = [r"list.*task", r"show.*task", r"my tasks", r"complete.*task", r"delete.*task", r"task.*\d+"]
        if any(re.search(pattern, message) for pattern in management_patterns):
            logger.info(f"Routing to task_management for user_id: {state['user_id']}")
            return "task_management"

        logger.info(f"Routing to general_chat for user_id: {state['user_id']}")
        return "general_chat"

    def _task_creation_decision(self, state: AgentState) -> str:
        """Decide next step after task extraction."""
        if state.get("awaiting_clarification"):
            logger.info(f"Task creation decision: clarification needed for user_id: {state['user_id']}")
            return "clarification"
        if state.get("pending_draft_ids"):
            logger.info(f"Task creation decision: pending drafts, waiting for user for user_id: {state['user_id']}")
            return "wait_for_user"  # CHANGED: Don't loop to HITL
        logger.info(f"Task creation decision: no drafts, ending for user_id: {state['user_id']}")
        return "end"

    def _hitl_decision(self, state: AgentState) -> str:
        """Decide action after HITL response."""
        # Find the last HumanMessage (actual user input) instead of any message
        user_input = None
        for msg in reversed(state["messages"]):
            if isinstance(msg, HumanMessage):
                user_input = msg.content.lower().strip()
                break
        
        if not user_input:
            logger.warning(f"No user input found for HITL decision for user_id: {state['user_id']}")
            return "wait_for_user"
            
        logger.info(f"HITL decision for user_id: {state['user_id']}, input_length: {len(user_input)}")

        # Skip AI-generated messages - they should not trigger execution
        ai_message_patterns = [
            "please review and confirm",
            "finalizing your draft tasks", 
            "please reply with:",
            "draft tasks (required)",
            "**please review",
            "reply with 'confirm'",
            "edit <number>:"
        ]

        if any(pattern in user_input for pattern in ai_message_patterns):
            return "wait_for_user"  # CHANGED: Wait instead of looping

        if any(word in user_input for word in ["confirm", "approve", "yes", "create", "go ahead"]) or "confirm drafts" in user_input:
            return "execute_tasks"
        elif any(word in user_input for word in ["edit", "modify", "change", "update"]):
            return "wait_for_user"  # CHANGED: Wait for next user input instead of looping
        elif any(word in user_input for word in ["more info", "clarify", "explain"]):
            return "clarification"
        elif any(word in user_input for word in ["cancel", "no", "abort", "stop"]) or "cancel drafts" in user_input:
            return "end"
        else:
            return "wait_for_user"  # CHANGED: Wait instead of looping

    def _clarification_decision(self, state: AgentState) -> str:
        """Decide next step after clarification."""
        if state.get("pending_draft_ids"):
            logger.info(f"Clarification decision: pending drafts, waiting for user for user_id: {state['user_id']}")
            return "wait_for_user"  # CHANGED: Wait instead of looping
        logger.info(f"Clarification decision: no drafts, ending for user_id: {state['user_id']}")
        return "end"

    def _wait_for_user(self, state: AgentState) -> AgentState:
        """NEW: Wait state that ends the workflow without looping."""
        state["current_step"] = "waiting_for_user"
        logger.info(f"Workflow completed, waiting for next user input for user_id: {state['user_id']}")
        return state

    async def _handle_task_creation(self, state: AgentState) -> AgentState:
        user_input = state["messages"][-1].content
        user_id = state["user_id"]
        timezone = state["timezone"]
        state["current_step"] = "task_creation"
        logger.info(f"Handling task creation for user_id: {user_id}, input_length: {len(user_input)}")

        extraction_result = self.extractor.extract_tasks(
            user_input, state.get("clarification_count", 0), None, timezone
        )

        tasks = self._format_extracted_tasks(extraction_result.get("tasks", []))
        if not tasks:
            state["messages"].append(AIMessage(content="❌ Could not extract any tasks. Please clarify your request."))
            logger.error(f"No tasks extracted for user_id: {user_id}, input_length: {len(user_input)}")
            return state

        # Create draft tasks
        draft_ids = []
        for task in tasks:
            result = await self.task_manager.create_draft_task(user_id, task, timezone)
            if result["success"]:
                draft_ids.append(result["draft_id"])
            else:
                state["messages"].append(AIMessage(content=result["message"]))
                logger.error(f"Failed to create draft task for user_id: {user_id}, error: {log_safe(result['message'])}")
                return state

        state["pending_draft_ids"] = draft_ids
        state["awaiting_hitl_confirmation"] = True

        # Show tasks for review
        tz = ZoneInfo(timezone)
        review_message = await self._format_drafts_for_review(draft_ids, user_id, tz)
        state["messages"].append(AIMessage(content=review_message))

        # Handle clarification if needed
        if extraction_result.get("needs_clarification") and state.get("clarification_count", 0) < 4:
            clarification_msg = extraction_result.get("clarification_question", "Could you provide more details?")
            step_info = f" (Step {state.get('clarification_count', 0) + 1}/4)"
            state["messages"].append(AIMessage(content=clarification_msg + step_info))
            state["awaiting_clarification"] = True
            state["clarification_context"] = extraction_result
            state["clarification_count"] = state.get("clarification_count", 0) + 1
            logger.info(f"Clarification requested for user_id: {user_id}, question_length: {len(clarification_msg)}")

        return state

    async def _handle_hitl_confirmation(self, state: AgentState) -> AgentState:
        """UPDATED: Handle HITL confirmation without creating loops."""
        user_input = state["messages"][-1].content.lower().strip()
        draft_ids = state.get("pending_draft_ids", [])
        user_id = state["user_id"]
        state["current_step"] = "hitl_confirmation"

        logger.info(f"Handling HITL confirmation for user_id: {user_id}, input_length: {len(user_input)}, draft_ids: {draft_ids}")

        # Skip AI-generated messages - don't process them as user input
        ai_message_patterns = [
            "please review and confirm",
            "finalizing your draft tasks", 
            "please reply with:",
            "draft tasks (required)",
            "**please review",
            "reply with 'confirm'",
            "edit <number>:"
        ]

        if any(pattern in user_input for pattern in ai_message_patterns):
            logger.info(f"Skipping AI-generated message for user_id: {user_id}")
            return state  # Don't process AI messages as user input

        if not draft_ids:
            state["messages"].append(AIMessage(content="❌ No draft tasks to confirm. Please create new tasks."))
            self._clear_hitl_state(state)
            logger.error(f"No draft tasks found for HITL confirmation for user_id: {user_id}")
            return state

        tz = ZoneInfo(state["timezone"])

        # Check for confirm with specific draft IDs or general confirm
        if "confirm drafts" in user_input or any(word in user_input for word in ["confirm", "approve", "yes", "create", "go ahead"]):
            # Extract specific draft IDs if provided (from button callback)
            if "confirm drafts" in user_input:
                try:
                    specific_ids = user_input.split("confirm drafts")[1].strip().split(",")
                    specific_ids = [int(id.strip()) for id in specific_ids if id.strip().isdigit()]
                    if specific_ids:
                        state["pending_draft_ids"] = specific_ids
                        logger.info(f"User confirmed specific draft IDs: {specific_ids} for user_id: {user_id}")
                    else:
                        logger.warning(f"Invalid draft IDs in confirm command for user_id: {user_id}")
                except Exception as e:
                    logger.error(f"Error parsing draft IDs from confirm command: {e}")
            
            state["messages"].append(AIMessage(content="✅ Finalizing your draft tasks..."))
            logger.info(f"User confirmed draft tasks for user_id: {user_id}")
            # Don't add another message here - let execute_tasks handle it

        elif any(word in user_input for word in ["edit", "modify", "change", "update"]):
            updated_draft_ids = await self._handle_draft_edits(user_input, draft_ids, user_id, state["timezone"])
            state["pending_draft_ids"] = updated_draft_ids
            review_message = await self._format_drafts_for_review(updated_draft_ids, user_id, tz)
            state["messages"].append(AIMessage(content=f"✅ **Drafts updated:**\n\n{review_message}"))
            logger.info(f"Draft tasks updated for user_id: {user_id}")

        elif "cancel drafts" in user_input or any(word in user_input for word in ["cancel", "no", "abort", "stop"]):
            # Extract specific draft IDs if provided (from button callback)
            ids_to_cancel = draft_ids  # Default to current draft IDs
            if "cancel drafts" in user_input:
                try:
                    specific_ids = user_input.split("cancel drafts")[1].strip().split(",")
                    specific_ids = [int(id.strip()) for id in specific_ids if id.strip().isdigit()]
                    if specific_ids:
                        ids_to_cancel = specific_ids
                        logger.info(f"User cancelled specific draft IDs: {specific_ids} for user_id: {user_id}")
                    else:
                        logger.warning(f"Invalid draft IDs in cancel command for user_id: {user_id}")
                except Exception as e:
                    logger.error(f"Error parsing draft IDs from cancel command: {e}")
            
            result = await self.task_manager.delete_draft_tasks(user_id, ids_to_cancel)
            state["messages"].append(AIMessage(content=result))
            self._clear_hitl_state(state)
            logger.info(f"User cancelled draft tasks for user_id: {user_id}")

        else:
            # Use AI-powered intent interpretation
            if not any(pattern in user_input for pattern in ai_message_patterns):
                intent = await self._interpret_hitl_intent(user_input, draft_ids, user_id, tz)
                
                if intent.type == "confirm" and intent.certainty > 0.7:
                    # Finalize all tasks
                    context = state.get("context")
                    result = await self.task_manager.finalize_draft_tasks(
                        user_id, draft_ids, state["timezone"], context=context
                    )
                    state["messages"].append(AIMessage(content=result))
                    self._clear_hitl_state(state)
                    logger.info(f"User confirmed and finalized draft tasks via AI intent for user_id: {user_id}")
                    
                elif intent.type == "cancel" and intent.certainty > 0.7:
                    # Cancel all tasks
                    result = await self.task_manager.delete_draft_tasks(user_id, draft_ids)
                    state["messages"].append(AIMessage(content=result))
                    self._clear_hitl_state(state)
                    logger.info(f"User cancelled draft tasks via AI intent for user_id: {user_id}")
                    
                elif intent.type == "edit" and intent.certainty > 0.6:
                    # Process edit intent
                    updated_draft_ids = await self._apply_intent_edits(intent, draft_ids, user_id, tz)
                    state["pending_draft_ids"] = updated_draft_ids
                    review_message = await self._format_drafts_for_review(updated_draft_ids, user_id, tz)
                    state["messages"].append(AIMessage(content=f"✅ **Drafts updated via AI:**\n\n{review_message}"))
                    logger.info(f"Draft tasks updated via AI intent for user_id: {user_id}")
                    
                elif intent.messages:
                    # AI needs clarification - preserve HITL state for retry
                    review_message = await self._format_drafts_for_review(draft_ids, user_id, tz)
                    state["messages"].append(AIMessage(content=f"❓ {intent.messages[0]}\n\n{review_message}"))
                    state["awaiting_hitl_confirmation"] = True  # Keep HITL state active
                    logger.info(f"AI requested clarification for user_id: {user_id}")
                    
                else:
                    # Low confidence or unknown intent - preserve HITL state and guide user
                    review_message = await self._format_drafts_for_review(draft_ids, user_id, tz)
                    confidence_msg = f" (certainty: {intent.certainty:.1f})" if hasattr(intent, 'certainty') else ""
                    state["messages"].append(AIMessage(
                        content=f"❓ I'm not confident about that command{confidence_msg}. Try:\n• 'confirm all tasks' or use the buttons\n• 'change the due date of task 2 to tomorrow'\n• 'make the first task high priority'\n• 'cancel all tasks'\n\n{review_message}"
                    ))
                    state["awaiting_hitl_confirmation"] = True  # Keep HITL state active
                    logger.info(f"Low confidence intent ({intent.type}: {getattr(intent, 'certainty', 0)}) for user_id: {user_id}")

        return state

    async def _handle_clarification(self, state: AgentState) -> AgentState:
        user_input = state["messages"][-1].content
        clarification_count = state.get("clarification_count", 1)
        user_id = state["user_id"]
        state["current_step"] = "clarification"
        logger.info(f"Handling clarification for user_id: {user_id}, input_length: {len(user_input)}")

        if "can you provide more details" in user_input.lower():
            logger.info(f"Skipping clarification for system-generated prompt for user_id: {user_id}")
            tz = ZoneInfo(state["timezone"])
            review_message = await self._format_drafts_for_review(state.get("pending_draft_ids", []), user_id, tz)
            state["messages"].append(AIMessage(content=review_message))
            return state

        draft_ids = state.get("pending_draft_ids", [])
        if not draft_ids:
            state["messages"].append(AIMessage(content="❌ No draft tasks to clarify. Please create new tasks."))
            self._clear_hitl_state(state)
            logger.error(f"No draft tasks found for clarification for user_id: {user_id}")
            return state

        extraction_result = self.extractor.extract_tasks(
            user_input, clarification_count, state.get("clarification_context"), state["timezone"]
        )

        tasks = self._format_extracted_tasks(extraction_result.get("tasks", []))
        if not tasks:
            tz = ZoneInfo(state["timezone"])
            review_message = await self._format_drafts_for_review(draft_ids, user_id, tz)
            state["messages"].append(AIMessage(content=f"❌ Could not extract clarification details. Please try rephrasing.\n\n{review_message}"))
            logger.error(f"No tasks extracted during clarification for user_id: {user_id}")
            return state

        # Update draft tasks with clarified information
        updated_draft_ids = []
        for i, (task, draft_id) in enumerate(zip(tasks, draft_ids)):
            update_data = {
                'task_name': task['task_name'],
                'description': task['description'],
                'due_date': task['due_date'] or None,
                'priority': task['priority'],
                'is_recurring': task['is_recurring'],
                'reminder_times': task['reminder_times'],
                'tags': task['tags']
            }
            self.db.execute(
                self.db.supabase.table('task_drafts').update(update_data).eq('user_id', user_id).eq('id', draft_id)
            )
            updated_draft_ids.append(draft_id)
            logger.info(f"Updated draft task ID: {draft_id} for user_id: {user_id}")

        state["pending_draft_ids"] = updated_draft_ids
        state["awaiting_hitl_confirmation"] = True

        # Show updated tasks for review
        tz = ZoneInfo(state["timezone"])
        review_message = await self._format_drafts_for_review(updated_draft_ids, user_id, tz)
        state["messages"].append(AIMessage(content=review_message))

        if extraction_result.get("needs_clarification") and clarification_count < 4:
            clarification_msg = extraction_result.get("clarification_question", "Could you provide more details?")
            step_info = f" (Step {clarification_count + 1}/4)"
            state["messages"].append(AIMessage(content=clarification_msg + step_info))
            state["clarification_context"] = extraction_result
            state["clarification_count"] = clarification_count + 1
            logger.info(f"Further clarification needed for user_id: {user_id}, question_length: {len(clarification_msg)}")
        else:
            state["awaiting_clarification"] = False
            state["clarification_context"] = None
            state["clarification_count"] = 0

        return state

    async def _handle_task_management(self, state: AgentState) -> AgentState:
        user_input = state["messages"][-1].content.lower()
        user_id, timezone = state["user_id"], state["timezone"]
        state["current_step"] = "task_management"
        logger.info(f"Handling task management for user_id: {user_id}, input_length: {len(user_input)}")

        if "list" in user_input or "show" in user_input or "my tasks" in user_input:
            result = await self.task_manager.list_tasks(user_id, timezone)
        elif "complete" in user_input or "mark" in user_input:
            task_id_match = re.search(r'(?:task\s+|id[:\s]+)(\d+)', user_input)
            result = await self.task_manager.complete_task(user_id, task_id_match.group(1), timezone) if task_id_match else "❌ Please specify task ID (e.g., 'complete task 123')"
        elif "delete" in user_input:
            task_id_match = re.search(r'(?:task\s+|id[:\s]+)(\d+)', user_input)
            result = await self.task_manager.delete_task(user_id, task_id_match.group(1)) if task_id_match else "❌ Please specify task ID (e.g., 'delete task 123')"
        else:
            result = await self.task_manager.list_tasks(user_id, timezone)

        state["messages"].append(AIMessage(content=result))
        return state

    def _handle_general_chat(self, state: AgentState) -> AgentState:
        user_input = state["messages"][-1].content.lower()
        state["current_step"] = "general_chat"
        logger.info(f"Handling general chat for user_id: {state['user_id']}, input_length: {len(user_input)}")

        if "help" in user_input or "commands" in user_input:
            response = HELP_TEXT
        elif "support" in user_input:
            response = SUPPORT_TEXT
        else:
            prompt = ChatPromptTemplate.from_messages([
                ("system", "You are Copilot, a task management AI. Be friendly, concise, and suggest task creation when relevant."),
                ("human", "{user_input}")
            ])
            chain = prompt | self.llm
            try:
                response = chain.invoke({"user_input": state["messages"][-1].content}).content
            except Exception as e:
                logger.error(f"Error in general chat for user_id: {state['user_id']}: {log_safe(str(e))}")
                response = "I'm here to help you manage tasks! Try saying 'remind me to call John tomorrow' or use /help for more options."

        state["messages"].append(AIMessage(content=response))
        return state

    def _clear_hitl_state(self, state: AgentState):
        """Helper to clear HITL state."""
        state["awaiting_hitl_confirmation"] = False
        state["pending_draft_ids"] = None
        state["awaiting_clarification"] = False
        state["clarification_context"] = None
        state["clarification_count"] = 0
        logger.info(f"Cleared HITL state for user_id: {state['user_id']}")

    def _format_extracted_tasks(self, extracted_tasks: List[Dict]) -> List[Dict]:
        """Clean up extracted tasks for storage."""
        return [
            {
                "task_name": task.get("task_name", "").strip(),
                "description": task.get("description", "").strip(),
                "due_date": task.get("due_date", "") or None,
                "priority": task.get("priority", "medium"),
                "is_recurring": task.get("is_recurring", False),
                "reminder_times": task.get("reminder_times", []),
                "tags": task.get("tags", ["general"])
            } for task in extracted_tasks if task.get("task_name", "").strip()
        ]

    async def _handle_draft_edits(self, user_input: str, draft_ids: List[int], user_id: str, timezone: str) -> List[int]:
        """Handle task editing during HITL review."""
        edit_match = re.search(r'edit\s+(\d+):?\s*(.+)', user_input, re.IGNORECASE)
        if not edit_match:
            logger.warning(f"Invalid edit command: {log_safe(user_input)}")
            return draft_ids

        draft_index = int(edit_match.group(1)) - 1
        edit_instructions = edit_match.group(2)

        if draft_index < 0 or draft_index >= len(draft_ids):
            logger.warning(f"Invalid draft index {draft_index} for edit")
            return draft_ids

        draft_id = draft_ids[draft_index]
        draft_response = self.db.execute(
            self.db.supabase.table('task_drafts').select('*').eq('user_id', user_id).eq('id', draft_id)
        )

        if draft_response["error"] or not draft_response["data"]:
            logger.error(f"Draft ID {draft_id} not found for edit")
            return draft_ids

        # Use the extractor to process edit instructions
        extraction_result = self.extractor.extract_tasks(
            edit_instructions, 0, {"tasks": [draft_response["data"][0]]}, timezone
        )

        if not extraction_result.get("tasks"):
            logger.error(f"No tasks extracted from edit instructions: {log_safe(edit_instructions)}")
            return draft_ids

        updated_task = self._format_extracted_tasks([extraction_result["tasks"][0]])[0]
        update_data = {
            'task_name': updated_task['task_name'],
            'description': updated_task['description'],
            'due_date': updated_task['due_date'] or None,
            'priority': updated_task['priority'],
            'is_recurring': updated_task['is_recurring'],
            'reminder_times': updated_task['reminder_times'],
            'tags': updated_task['tags']
        }

        self.db.execute(
            self.db.supabase.table('task_drafts').update(update_data).eq('user_id', user_id).eq('id', draft_id)
        )
        logger.info(f"Updated draft task ID: {draft_id} for user_id: {user_id}")
        return draft_ids

    async def _interpret_hitl_intent(self, user_input: str, draft_ids: List[int], user_id: str, tz: ZoneInfo) -> Intent:
        """AI-powered intent interpretation using structured outputs."""
        try:
            # Get current draft tasks for context
            draft_tasks = []
            for i, draft_id in enumerate(draft_ids, 1):
                draft_response = self.db.execute(
                    self.db.supabase.table('task_drafts').select('*').eq('user_id', user_id).eq('id', draft_id)
                )
                if draft_response["data"]:
                    draft = draft_response["data"][0]
                    draft_tasks.append({
                        "number": i,
                        "id": draft_id,
                        "name": draft["task_name"],
                        "description": draft["description"],
                        "priority": draft["priority"],
                        "due_date": draft.get("due_date"),
                        "tags": draft.get("tags", [])
                    })

            # Create context for AI
            task_context = "\n".join([f"{task['number']}. {task['name']} ({task['priority']} priority)" for task in draft_tasks])
            
            # Set up JsonOutputParser with Intent union type
            parser = JsonOutputParser(pydantic_object=Intent)
            
            # Create system prompt for intent recognition
            system_prompt = """You are an expert task management assistant. Analyze the user's command and classify their intent.

Context: User is reviewing draft tasks:
{task_context}

User's timezone: {timezone}
Command: "{user_input}"

Classify the intent as one of:
1. CONFIRM: User wants to finalize all or some tasks
2. CANCEL: User wants to delete/cancel all or some tasks  
3. EDIT: User wants to modify task details

For EDIT intents, identify:
- Which tasks to modify (by index, all, or attribute filter)
- What operations to perform (set_due_date, set_priority, add_tags, etc.)

Return a JSON object with:
- type: "confirm" | "cancel" | "edit"
- certainty: 0.0-1.0 (confidence level)
- messages: [] (empty unless clarification needed)

For edit intents, also include:
- selections: object describing which tasks to select
- operations: list of operations to perform

Examples:
- "confirm all" → {{"type": "confirm", "certainty": 1.0}}
- "cancel everything" → {{"type": "cancel", "certainty": 1.0}}
- "change task 2 due date to tomorrow" → {{"type": "edit", "certainty": 0.9, "selections": {{"by": "index", "indices": [2]}}, "operations": [{{"operation": "set_due_date", "value": "tomorrow"}}]}}

{format_instructions}"""

            # Create the prompt
            prompt = ChatPromptTemplate.from_template(system_prompt)
            
            # Create the chain
            chain = prompt | self.llm | parser
            
            # Invoke with proper parameters
            result = await asyncio.to_thread(
                chain.invoke,
                {
                    "task_context": task_context,
                    "timezone": str(tz), 
                    "user_input": user_input,
                    "format_instructions": parser.get_format_instructions()
                }
            )
            
            # Create proper Intent object based on type
            if result.get("type") == "edit":
                intent = EditIntent(
                    type="edit",
                    certainty=result.get("certainty", 0.5),
                    messages=result.get("messages", []),
                    selections=TaskSelection(**result.get("selections", {"by": "all", "indices": [], "ids": [], "attribute_filter": {}})),
                    operations=[PatchOp(**op) for op in result.get("operations", [])]
                )
            elif result.get("type") == "confirm":
                intent = ConfirmIntent(type="confirm", certainty=result.get("certainty", 0.5), messages=result.get("messages", []))
            elif result.get("type") == "cancel":  
                intent = CancelIntent(type="cancel", certainty=result.get("certainty", 0.5), messages=result.get("messages", []))
            else:
                # Fallback intent for unrecognized commands
                intent = Intent(type="unknown", certainty=0.0, messages=["I didn't understand that command. Please try again."])
            
            logger.info(f"AI intent recognized for user_id: {user_id}: {intent.type} (certainty: {intent.certainty})")
            return intent
            
        except Exception as e:
            logger.error(f"Error interpreting HITL intent: {e}")
            return Intent(type="unknown", certainty=0.0, messages=[f"Error processing command: {str(e)}"])

    async def _apply_intent_edits(self, intent: EditIntent, draft_ids: List[int], user_id: str, tz: ZoneInfo) -> List[int]:
        """Apply edit operations from AI intent to draft tasks."""
        try:
            # Resolve which tasks to edit based on selections
            target_indices = []
            
            if intent.selections.by == "all":
                target_indices = list(range(len(draft_ids)))
            elif intent.selections.by == "index" and intent.selections.indices:
                # Convert 1-based to 0-based indices
                target_indices = [i-1 for i in intent.selections.indices if 0 < i <= len(draft_ids)]
            elif intent.selections.by == "id" and intent.selections.ids:
                # Map draft IDs to indices
                for draft_id in intent.selections.ids:
                    if draft_id in draft_ids:
                        target_indices.append(draft_ids.index(draft_id))
            elif intent.selections.by == "attribute" and intent.selections.attribute_filter:
                # Filter tasks by attributes (priority, tags, etc.)
                for i, draft_id in enumerate(draft_ids):
                    draft_response = self.db.execute(
                        self.db.supabase.table('task_drafts').select('*').eq('user_id', user_id).eq('id', draft_id)
                    )
                    if draft_response["data"]:
                        draft = draft_response["data"][0]
                        # Check attribute filters
                        for attr, value in intent.selections.attribute_filter.items():
                            if attr == "priority" and draft.get("priority", "").lower() == value.lower():
                                target_indices.append(i)
                            elif attr == "has_due_date" and bool(draft.get("due_date")) == (value.lower() == "true"):
                                target_indices.append(i)
                        target_indices = list(set(target_indices))  # Remove duplicates
            
            if not target_indices:
                logger.warning(f"No valid tasks selected for edit intent for user_id: {user_id}")
                return draft_ids
                
            # Apply operations to each target task
            for task_index in target_indices:
                if task_index >= len(draft_ids):
                    continue
                    
                draft_id = draft_ids[task_index]
                
                # Get current draft
                draft_response = self.db.execute(
                    self.db.supabase.table('task_drafts').select('*').eq('user_id', user_id).eq('id', draft_id)
                )
                
                if not draft_response["data"]:
                    logger.error(f"Draft ID {draft_id} not found for intent edit")
                    continue
                
                current_draft = draft_response["data"][0]
                update_data = {}
                
                # Process each operation
                for operation in intent.operations:
                    if operation.operation == "set_due_date":
                        # Use the task extractor to parse natural language dates
                        date_context = {"tasks": [current_draft]}
                        extraction_result = self.extractor.extract_tasks(
                            f"due {operation.value}", 0, date_context, str(tz)
                        )
                        if extraction_result.get("tasks") and extraction_result["tasks"][0].get("due_date"):
                            update_data['due_date'] = extraction_result["tasks"][0]["due_date"]
                    
                    elif operation.operation == "set_priority":
                        priority_value = operation.value.lower()
                        if priority_value in ["high", "medium", "low"]:
                            update_data['priority'] = priority_value
                            
                    elif operation.operation == "rename":
                        if operation.value and operation.value.strip():
                            update_data['task_name'] = operation.value.strip()
                        
                    elif operation.operation == "add_tags":
                        current_tags = current_draft.get('tags', [])
                        new_tags = [tag.strip() for tag in operation.value.split(',')]
                        update_data['tags'] = list(set(current_tags + new_tags))
                        
                    elif operation.operation == "remove_tags":
                        current_tags = current_draft.get('tags', [])
                        remove_tags = [tag.strip() for tag in operation.value.split(',')]
                        update_data['tags'] = [tag for tag in current_tags if tag not in remove_tags]
                        
                    elif operation.operation == "set_reminders" and operation.reminder_times:
                        update_data['reminder_times'] = operation.reminder_times
                        
                # Apply updates if any
                if update_data:
                    self.db.execute(
                        self.db.supabase.table('task_drafts').update(update_data).eq('user_id', user_id).eq('id', draft_id)
                    )
                    logger.info(f"Applied intent edits to draft ID: {draft_id} for user_id: {user_id}")
                    
            return draft_ids
            
        except Exception as e:
            logger.error(f"Error applying intent edits: {e}")
            return draft_ids


    async def _format_drafts_for_review(self, draft_ids: List[int], user_id: str, tz: ZoneInfo) -> str:
        """Format tasks for user review."""
        response = "📋 **Please review and confirm the following draft tasks (required):**\n\n"
        drafts = []

        for i, draft_id in enumerate(draft_ids, 1):
            draft_response = self.db.execute(
                self.db.supabase.table('task_drafts').select('*').eq('user_id', user_id).eq('id', draft_id)
            )
            if draft_response["error"] or not draft_response["data"]:
                logger.error(f"Draft ID {draft_id} not found for user_id: {user_id}")
                continue

            draft = draft_response["data"][0]
            drafts.append(draft)

            due_info = ""
            if draft.get('due_date'):
                try:
                    due_dt = datetime.fromisoformat(draft['due_date'])
                    due_info = f"\n   📅 Due: {due_dt.astimezone(tz).strftime('%Y-%m-%d %H:%M')}"
                except:
                    pass

            reminder_info = ""
            if draft.get('reminder_times'):
                try:
                    times = []
                    for t in draft['reminder_times']:
                        reminder_dt = datetime.fromisoformat(t)
                        times.append(reminder_dt.astimezone(tz).strftime('%H:%M'))
                    reminder_info = f"\n   ⏰ Reminders: {', '.join(times)}"
                except:
                    pass

            tags_info = f"\n   🏷️ Tags: {', '.join(draft['tags'])}" if draft.get('tags') else ""

            response += f"{i}. **{draft['task_name']}** ({draft['priority'].title()} priority) (Draft ID: {draft['id']}){due_info}{reminder_info}{tags_info}\n"
            response += f"   📝 {draft['description']}\n\n"

        if not drafts:
            logger.warning(f"No draft tasks found for review for user_id: {user_id}")
            return "❌ No draft tasks found for review."

        response += "**👇 Use the buttons below OR type natural language commands:**\n"
        response += "💬 *Try saying: 'confirm all tasks', 'change task 2 due date to tomorrow', 'make the first task high priority'*"
        logger.info(f"Formatted {len(drafts)} draft tasks for review for user_id: {user_id}")
        
        # Add marker for HITL buttons - this will be detected by the main bot handler
        response += f"\n\n[HITL_BUTTONS:{','.join(map(str, draft_ids))}]"
        return response

    async def _execute_task_creation(self, state: AgentState) -> AgentState:
        """Execute the actual task creation after HITL confirmation."""
        draft_ids = state.get("pending_draft_ids", [])
        user_id = state["user_id"]
        state["current_step"] = "execute_tasks"
        logger.info(f"Executing task creation for user_id: {user_id}, draft_ids: {draft_ids}")

        if not draft_ids:
            state["messages"].append(AIMessage(content="❌ No draft tasks to finalize."))
            self._clear_hitl_state(state)
            logger.error(f"No draft tasks to finalize for user_id: {user_id}")
            return state

        context = state.get("context")
        result = await self.task_manager.finalize_draft_tasks(
            user_id, draft_ids, state["timezone"], context=context
        )

        state["messages"].append(AIMessage(content=result))
        self._clear_hitl_state(state)
        return state

    async def process_message(self, user_id: str, message: str, context=None) -> str:
        """Process message with proper recursion limit and state management."""
        response = self.db.execute(
            self.db.supabase.table('user_profiles').select('timezone').eq('user_id', user_id)
        )
        timezone = response["data"][0].get('timezone', 'Africa/Lagos') if response.get("data") else 'Africa/Lagos'
        logger.info(f"Processing message for user_id: {user_id}, message_length: {len(message)}, timezone: {timezone}")

        config = {
            "configurable": {
                "thread_id": user_id
            },
            "recursion_limit": 50  # Increase recursion limit
        }

        try:
            existing_state = await self.app.aget_state(config)
            if existing_state and existing_state.values:
                new_message = HumanMessage(content=message)
                existing_state.values["messages"].append(new_message)
                existing_state.values["context"] = context
                result = await self.app.ainvoke(existing_state.values, config)
            else:
                initial_state = {
                    "messages": [HumanMessage(content=message)],
                    "user_id": user_id,
                    "awaiting_clarification": False,
                    "clarification_context": None,
                    "clarification_count": 0,
                    "timezone": timezone,
                    "pending_draft_ids": None,
                    "awaiting_hitl_confirmation": False,
                    "current_step": "routing",
                    "context": context
                }
                result = await self.app.ainvoke(initial_state, config)
        except Exception as e:
            logger.error(f"Error processing message for user_id: {user_id}: {log_safe(str(e))}")
            # Fallback to new state if processing fails
            initial_state = {
                "messages": [HumanMessage(content=message)],
                "user_id": user_id,
                "awaiting_clarification": False,
                "clarification_context": None,
                "clarification_count": 0,
                "timezone": timezone,
                "pending_draft_ids": None,
                "awaiting_hitl_confirmation": False,
                "current_step": "routing",
                "context": context
            }
            result = await self.app.ainvoke(initial_state, config)

        response_content = result["messages"][-1].content
        logger.info(f"Response for user_id: {user_id}, response_length: {len(response_content)}")
        return response_content