# app/services/agents/alerts_agent.py
import os
import json
import re
from datetime import datetime, timedelta
from typing import Dict, List, Optional
import asyncio
from dotenv import load_dotenv
from zoneinfo import ZoneInfo
import logging

# LangChain imports
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser
from pydantic import BaseModel, Field

# Supabase import
from supabase import create_client, Client

from app.core.config import settings

# Configure logging
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

# Helper function to remove emojis from log messages for Windows compatibility


def log_safe(message):
    """Remove emojis and special characters for safe logging on Windows."""
    if not isinstance(message, str):
        message = str(message)
    return re.sub(r'[^\w\s\-\.,;:!?()\[\]{}@#$%&*+=<>/\\|`~]', '', message)


# === DATA MODELS ===
class TaskExtraction(BaseModel):
    task_name: str = Field(description="Extracted main task title")
    description: Optional[str] = Field(
        description="Extracted detailed description")
    due_date: Optional[str] = Field(
        description="Extracted due date in ISO format")
    priority: str = Field(
        default="medium", description="Extracted priority level")
    is_recurring: bool = Field(
        default=False, description="Extracted recurring status")
    reminder_times: Optional[List[str]] = Field(
        default=[], description="Extracted reminder timestamps")
    tags: Optional[List[str]] = Field(
        default=[], description="Extracted tags/categories")


class MultipleTaskExtraction(BaseModel):
    tasks: List[TaskExtraction] = Field(description="List of extracted tasks")
    success: bool = Field(
        default=True, description="Whether extraction was successful")


# === DATABASE CLIENT ===
class DatabaseClient:
    def __init__(self):
        self.supabase = create_client(
            os.getenv("SUPABASE_URL"),
            os.getenv("SUPABASE_KEY")
        )

    def execute(self, operation) -> Dict:
        try:
            response = operation.execute()
            logger.info("Database operation executed successfully")
            return {"data": response.data, "error": None}
        except Exception as e:
            logger.error(f"Database error: {log_safe(str(e))}")
            return {"data": None, "error": f"❌ Database error: {str(e)}"}


# === TASK MANAGER ===
class TaskManager:
    def __init__(self):
        self.db = DatabaseClient()

    def _ensure_user_exists(self, user_id: str, timezone: str = 'Africa/Lagos') -> bool:
        """Ensure user profile exists in database."""
        user_response = self.db.execute(
            self.db.supabase.table('user_profiles').select(
                'timezone').eq('user_id', user_id)
        )
        if user_response["error"]:
            logger.error(
                f"Failed to check user existence: {log_safe(user_response['error'])}")
            return False

        if not user_response["data"]:
            tz = ZoneInfo(timezone)
            insert_response = self.db.execute(
                self.db.supabase.table('user_profiles').upsert({
                    'user_id': user_id,
                    'username': f"user_{user_id}",
                    'timezone': timezone,
                    'created_at': datetime.now(tz).isoformat()
                }, on_conflict=['user_id'])
            )
            if insert_response["error"]:
                logger.error(
                    f"Failed to create user profile: {log_safe(insert_response['error'])}")
                return False
            logger.info(f"Created user profile for user_id: {user_id}")
        return True

    async def create_task(self, user_id: str, task: Dict, timezone: str = 'Africa/Lagos') -> Dict:
        """Create a task directly (no draft)."""
        if not self._ensure_user_exists(user_id, timezone):
            logger.error(
                f"Failed to ensure user exists for user_id: {user_id}")
            return {"success": False, "message": "❌ Error setting up user profile"}

        tz = ZoneInfo(timezone)
        task_data = {
            'user_id': user_id,
            'task_name': task.get('task_name', '').strip(),
            'description': task.get('description', '').strip(),
            'due_date': task.get('due_date') or None,
            'priority': task.get('priority', 'medium'),
            'status': 'pending',
            'created_at': datetime.now(tz).isoformat(),
            'is_recurring': task.get('is_recurring', False),
            'reminder_times': task.get('reminder_times', []),
            'tags': task.get('tags', [])
        }

        response = self.db.execute(
            self.db.supabase.table('tasks').insert(task_data)
        )
        if response["error"] or not response["data"]:
            logger.error(
                f"Failed to create task: {log_safe(response.get('error', 'Unknown error'))}")
            return {"success": False, "message": response.get("error", "❌ Failed to create task")}

        created_task = response["data"][0]
        logger.info(
            f"Created task: {log_safe(created_task['task_name'])} (ID: {created_task['id']}) for user_id: {user_id}")

        # Create reminders if specified
        self._create_reminders(created_task, user_id, tz)

        return {
            "success": True,
            "message": self._format_task_response(created_task, tz),
            "task_id": created_task['id']
        }

    def _create_reminders(self, task: Dict, user_id: str, tz: ZoneInfo):
        """Create reminder entries for a task."""
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
            logger.info(
                f"Created reminder for task ID: {task['id']} at {reminder_time}")

    def _format_task_response(self, task: Dict, tz: ZoneInfo) -> str:
        """Format task information for display."""
        due_info = ""
        if task.get('due_date'):
            try:
                due_dt = datetime.fromisoformat(
                    task['due_date']).astimezone(tz)
                due_info = f" due on {due_dt.strftime('%Y-%m-%d %H:%M')}"
            except:
                pass

        reminder_info = ""
        if task.get('reminder_times'):
            try:
                times = [datetime.fromisoformat(t).astimezone(
                    tz).strftime('%H:%M') for t in task['reminder_times']]
                reminder_info = f" with reminder{'s' if len(times) > 1 else ''} at {', '.join(times)}"
            except:
                pass

        tags_info = f"\n🏷️ Tags: {', '.join(task['tags'])}" if task.get(
            'tags') else ""

        return (f"✅ **Task created!**\n\n"
                f"📋 **{task['task_name']}**{due_info}{reminder_info}{tags_info}\n\n"
                f"📝 {task.get('description', 'No description')}")

    async def list_tasks(self, user_id: str, timezone: str = 'Africa/Lagos', status: str = "pending") -> str:
        """List user's tasks."""
        response = self.db.execute(
            self.db.supabase.table('tasks').select(
                '*').eq('user_id', user_id).eq('status', status)
        )
        if response["error"]:
            logger.error(
                f"Failed to list tasks: {log_safe(response['error'])}")
            return f"❌ {response['error']}"

        tasks = response["data"]
        if not tasks:
            return "📝 No tasks yet. Try 'remind me to buy groceries tomorrow'!"

        tz = ZoneInfo(timezone)
        task_list = f"📋 **Your {status.title()} Tasks:**\n\n"
        priority_emoji = {"high": "🔴", "medium": "🟡", "low": "🟢"}

        for task in sorted(tasks, key=lambda x: (x.get('due_date') or "9999-12-31T23:59:59")):
            emoji = priority_emoji.get(task.get('priority', 'medium'), '🟡')
            due_info = ""
            if task.get('due_date'):
                try:
                    due_dt = datetime.fromisoformat(
                        task['due_date']).astimezone(tz)
                    due_info = f"\n   📅 Due: {due_dt.strftime('%Y-%m-%d %H:%M')}"
                except:
                    pass
            tags_info = f"\n   🏷️ {', '.join(task['tags'])}" if task.get(
                'tags') else ""

            task_list += f"{emoji} **{task['task_name']}** (ID: {task['id']}){due_info}{tags_info}\n"
            if task.get('description'):
                task_list += f"   📝 {task['description']}\n"
            task_list += "\n"

        logger.info(f"Listed {len(tasks)} tasks for user_id: {user_id}")
        return task_list

    async def complete_task(self, user_id: str, task_id: str, timezone: str = 'Africa/Lagos') -> str:
        """Mark a task as completed."""
        tz = ZoneInfo(timezone)
        response = self.db.execute(
            self.db.supabase.table('tasks').update({
                'status': 'completed',
                'updated_at': datetime.now(tz).isoformat()
            }).eq('user_id', user_id).eq('id', task_id)
        )
        if response["error"]:
            logger.error(
                f"Failed to complete task ID: {task_id}: {log_safe(response['error'])}")
            return f"❌ {response['error']}"
        if response["data"]:
            logger.info(
                f"Completed task: {log_safe(response['data'][0]['task_name'])} (ID: {task_id})")
            return f"🎉 Task **{response['data'][0]['task_name']}** completed!"
        return f"❌ Task ID {task_id} not found"

    async def delete_task(self, user_id: str, task_id: str) -> str:
        """Delete a task."""
        task_response = self.db.execute(
            self.db.supabase.table('tasks').select('task_name').eq(
                'user_id', user_id).eq('id', task_id)
        )
        if task_response["error"] or not task_response["data"]:
            logger.error(f"Task ID {task_id} not found for deletion")
            return f"❌ Task ID {task_id} not found"

        self.db.execute(
            self.db.supabase.table('tasks').delete().eq(
                'user_id', user_id).eq('id', task_id)
        )
        logger.info(
            f"Deleted task: {log_safe(task_response['data'][0]['task_name'])} (ID: {task_id})")
        return f"🗑️ Task **{task_response['data'][0]['task_name']}** deleted"


# === TASK EXTRACTOR ===
class TaskExtractor:
    def __init__(self):
        self.llm = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            google_api_key=settings.GEMINI_API_KEY,
            temperature=0.1
        )

    async def extract_tasks(self, user_input: str, timezone: str = 'Africa/Lagos') -> Dict:
        """Extract task information from natural language input."""
        tz = ZoneInfo(timezone)
        current_time = datetime.now(tz).isoformat()

        system_message = f"""
Extract tasks from user input. Focus on the primary task unless multiple tasks are explicitly listed.
Current time in {timezone}: {current_time}

Rules:
1. Extract ONE primary task unless multiple tasks are clearly specified (e.g., 'task1 and task2', '1. task1 2. task2').
2. For event-related inputs, create a task for organizing the event with details in the description.
3. Generate task_name (3-8 words), description (1-2 sentences incorporating ALL relevant details).
4. Convert dates to ISO format in {timezone} (e.g., 'tomorrow' → next day at 12:00).
5. Set priority: 'urgent'/'now' → high, 'today'/'soon' → medium, else low.
6. Handle special cases: 'in a minute' → high priority + 1min reminder.
7. Generate 1-3 relevant tags based on context.
8. Avoid over-segmenting; consolidate related details into one task unless explicitly separate.

Return JSON with 'tasks' array and 'success' boolean.
"""

        prompt = ChatPromptTemplate.from_messages([
            ("system", system_message),
            ("human", "Extract tasks from: {user_input}")
        ])

        parser = JsonOutputParser(pydantic_object=MultipleTaskExtraction)
        chain = prompt | self.llm | parser

        try:
            result = await chain.ainvoke({"user_input": user_input})
            self._apply_special_cases(result.get("tasks", []), user_input, tz)
            self._ensure_required_fields(result.get("tasks", []), user_input)
            logger.info(
                f"Extracted {len(result.get('tasks', []))} tasks from input: {log_safe(user_input[:50])}")
            return result
        except Exception as e:
            logger.error(f"Task extraction failed: {log_safe(str(e))}")
            return self._fallback_extraction(user_input, tz)

    def _apply_special_cases(self, tasks: List[Dict], user_input: str, tz: ZoneInfo):
        """Apply special case handling for specific phrases."""
        if "in a minute" in user_input.lower():
            reminder_time = (datetime.now(tz) + timedelta(minutes=1)
                             ).replace(microsecond=0).isoformat()
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
                tomorrow.replace(hour=10, minute=0, second=0,
                                 microsecond=0).isoformat(),
                tomorrow.replace(hour=17, minute=0, second=0,
                                 microsecond=0).isoformat()
            ]
            for task in tasks:
                task.update(
                    {"is_recurring": True, "reminder_times": reminder_times})

    def _ensure_required_fields(self, tasks: List[Dict], user_input: str):
        """Ensure all tasks have required fields."""
        for i, task in enumerate(tasks):
            if not task.get("task_name"):
                task["task_name"] = f"Task {i+1}: {user_input[:30]}..."
            if not task.get("description"):
                task["description"] = f"Task created from: '{user_input}'"
            if not task.get("tags"):
                task["tags"] = ["general"]

    def _fallback_extraction(self, user_input: str, tz: ZoneInfo) -> Dict:
        """Fallback extraction when AI fails."""
        task = {
            "task_name": f"Task: {user_input[:30]}...",
            "description": user_input,
            "priority": "medium",
            "is_recurring": False,
            "reminder_times": [],
            "tags": ["general"],
            "due_date": None
        }

        if "in a minute" in user_input.lower():
            reminder_time = (datetime.now(tz) + timedelta(minutes=1)
                             ).replace(microsecond=0).isoformat()
            task.update({
                "reminder_times": [reminder_time],
                "due_date": reminder_time,
                "priority": "high"
            })

        logger.info(
            f"Fallback extraction for input: {log_safe(user_input[:50])}")
        return {"tasks": [task], "success": True}


# === TOOL IMPLEMENTATION FOR BASE AGENT ===
task_manager = TaskManager()
task_extractor = TaskExtractor()


async def alerts_agent_tool_async(query: str, context: str = "") -> str:
    """
    Main tool function called by base_agent for alerts/task management.
    
    Args:
        query: User's natural language query
        context: Conversation context (format: "role: content\\nrole: content")
    
    Returns:
        str: Formatted response for the user
    """
    try:
        # Extract user_id from context if available (format: "user: <user_id>")
        user_id = "default_user"
        timezone = "Africa/Lagos"

        # Parse context to extract user_id and timezone
        if context:
            for line in context.split('\n'):
                if line.startswith('user_id:'):
                    user_id = line.split('user_id:')[1].strip()
                elif line.startswith('timezone:'):
                    timezone = line.split('timezone:')[1].strip()

        logger.info(
            f"Alerts agent processing query for user_id: {user_id}, query_length: {len(query)}")

        # Determine action based on query
        query_lower = query.lower()

        # Task management commands
        if any(keyword in query_lower for keyword in ["list", "show", "my tasks"]):
            return await task_manager.list_tasks(user_id, timezone)

        if "complete" in query_lower or "mark" in query_lower:
            task_id_match = re.search(
                r'(?:task\s+|id[:\s]+)(\d+)', query_lower)
            if task_id_match:
                return await task_manager.complete_task(user_id, task_id_match.group(1), timezone)
            return "❌ Please specify task ID (e.g., 'complete task 123')"

        if "delete" in query_lower:
            task_id_match = re.search(
                r'(?:task\s+|id[:\s]+)(\d+)', query_lower)
            if task_id_match:
                return await task_manager.delete_task(user_id, task_id_match.group(1))
            return "❌ Please specify task ID (e.g., 'delete task 123')"

        # Task creation - extract and create
        extraction_result = await task_extractor.extract_tasks(query, timezone)

        if not extraction_result.get("success") or not extraction_result.get("tasks"):
            return "❌ Could not extract task information. Please try rephrasing your request."

        tasks = extraction_result.get("tasks", [])
        results = []

        for task in tasks:
            result = await task_manager.create_task(user_id, task, timezone)
            if result["success"]:
                results.append(result["message"])
            else:
                results.append(f"❌ Failed to create task: {result['message']}")

        return "\n\n".join(results)

    except Exception as e:
        logger.exception(f"Error in alerts agent tool: {e}")
        return f"❌ An error occurred while processing your request: {str(e)}"


# === SYNCHRONOUS WRAPPER (if needed) ===
def alerts_agent_tool(query: str, context: str = "") -> str:
    """Synchronous wrapper for alerts_agent_tool_async."""
    return asyncio.run(alerts_agent_tool_async(query, context))
