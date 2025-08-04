import os
import json
import re
from datetime import datetime, timedelta
from typing import Dict, List, Optional, TypedDict, Annotated, Any
from uuid import uuid4
import asyncio

# LangChain imports
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser
from pydantic import BaseModel, Field

# LangGraph imports
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver

# Data models
class Task(BaseModel):
    id: str = Field(description="Unique task ID")
    title: str = Field(description="Task title")
    description: Optional[str] = Field(description="Task description")
    due_date: Optional[str] = Field(description="Due date in YYYY-MM-DD format")
    due_time: Optional[str] = Field(description="Due time in HH:MM format")
    priority: str = Field(default="medium", description="Priority: low, medium, high")
    status: str = Field(default="active", description="Status: active, completed, deleted")
    created_at: str = Field(description="Creation timestamp")
    reminder_frequency: Optional[str] = Field(description="daily, weekly, monthly")

class TaskExtraction(BaseModel):
    title: str = Field(description="Extracted task title")
    description: Optional[str] = Field(description="Extracted task description")
    due_date: Optional[str] = Field(description="Extracted due date in YYYY-MM-DD format")
    due_time: Optional[str] = Field(description="Extracted due time in HH:MM format")
    priority: str = Field(default="medium", description="Extracted priority")
    reminder_frequency: Optional[str] = Field(description="Extracted reminder frequency")
    needs_clarification: bool = Field(description="Whether clarification is needed")
    clarification_question: Optional[str] = Field(description="Question to ask for clarification")

# State definition
class AgentState(TypedDict):
    messages: Annotated[List, "Messages in the conversation"]
    user_id: str
    current_task: Optional[Dict]
    awaiting_clarification: bool
    clarification_context: Optional[Dict]
    last_action: Optional[str]

class TaskManager:
    """Task management functionality"""

    def __init__(self):
        self.tasks_db: Dict[str, List[Task]] = {}

    def create_task(self, user_id: str, title: str, description: str = "", 
                   due_date: str = "", due_time: str = "", priority: str = "medium",
                   reminder_frequency: str = "") -> str:
        """Create a new task for the user."""
        task_id = str(uuid4())[:8]

        task = Task(
            id=task_id,
            title=title,
            description=description,
            due_date=due_date if due_date else None,
            due_time=due_time if due_time else None,
            priority=priority,
            created_at=datetime.now().isoformat(),
            reminder_frequency=reminder_frequency if reminder_frequency else None
        )

        if user_id not in self.tasks_db:
            self.tasks_db[user_id] = []

        self.tasks_db[user_id].append(task)

        due_info = ""
        if task.due_date:
            due_info = f" due on {task.due_date}"
            if task.due_time:
                due_info += f" at {task.due_time}"

        reminder_info = ""
        if task.reminder_frequency:
            reminder_info = f" with {task.reminder_frequency} reminders"

        return f"✅ Task created successfully!\n\n📋 **{title}** (ID: {task_id}){due_info}{reminder_info}"

    def list_tasks(self, user_id: str, status: str = "active") -> str:
        """List all tasks for the user."""
        if user_id not in self.tasks_db or not self.tasks_db[user_id]:
            return "📝 You don't have any tasks yet. Type something like 'remind me to buy groceries tomorrow' to create one!"

        tasks = [t for t in self.tasks_db[user_id] if t.status == status]

        if not tasks:
            return f"📝 No {status} tasks found."

        task_list = f"📋 **Your {status.title()} Tasks:**\n\n"

        for task in sorted(tasks, key=lambda x: (x.due_date or "9999-12-31", x.due_time or "23:59")):
            due_info = ""
            if task.due_date:
                due_info = f"\n   📅 Due: {task.due_date}"
                if task.due_time:
                    due_info += f" at {task.due_time}"

            priority_emoji = {"high": "🔴", "medium": "🟡", "low": "🟢"}

            task_list += f"{priority_emoji.get(task.priority, '🟡')} **{task.title}** (ID: `{task.id}`){due_info}\n"
            if task.description:
                task_list += f"   📝 {task.description}\n"
            task_list += "\n"

        return task_list

    def complete_task(self, user_id: str, task_id: str) -> str:
        """Mark a task as completed."""
        if user_id not in self.tasks_db:
            return "❌ No tasks found for your account."

        for task in self.tasks_db[user_id]:
            if task.id == task_id:
                task.status = "completed"
                return f"🎉 Great job! Task **{task.title}** marked as completed!"

        return f"❌ Task with ID {task_id} not found."

    def delete_task(self, user_id: str, task_id: str) -> str:
        """Delete a task."""
        if user_id not in self.tasks_db:
            return "❌ No tasks found for your account."

        for i, task in enumerate(self.tasks_db[user_id]):
            if task.id == task_id:
                deleted_task = self.tasks_db[user_id].pop(i)
                return f"🗑️ Task **{deleted_task.title}** deleted successfully."

        return f"❌ Task with ID {task_id} not found."

    def get_task_details(self, user_id: str, task_id: str) -> str:
        """Get detailed information about a specific task."""
        if user_id not in self.tasks_db:
            return "❌ No tasks found for your account."

        for task in self.tasks_db[user_id]:
            if task.id == task_id:
                details = f"📋 **Task Details**\n\n"
                details += f"**Title:** {task.title}\n"
                details += f"**ID:** `{task.id}`\n"
                details += f"**Status:** {task.status.title()}\n"
                details += f"**Priority:** {task.priority.title()}\n"

                if task.description:
                    details += f"**Description:** {task.description}\n"

                if task.due_date:
                    details += f"**Due Date:** {task.due_date}\n"
                    if task.due_time:
                        details += f"**Due Time:** {task.due_time}\n"

                if task.reminder_frequency:
                    details += f"**Reminder:** {task.reminder_frequency.title()}\n"

                details += f"**Created:** {task.created_at[:19].replace('T', ' ')}\n"

                return details

        return f"❌ Task with ID {task_id} not found."

class CopilotAgent:
    def __init__(self, gemini_api_key: str):
        # Initialize Gemini AI
        self.llm = ChatGoogleGenerativeAI(
            model="gemini-1.5-pro",
            google_api_key=gemini_api_key,
            temperature=0.1,
            convert_system_message_to_human=True
        )

        # Initialize task manager
        self.task_manager = TaskManager()

        # User context storage
        self.user_contexts: Dict[str, Dict] = {}

        # Build the graph
        self.workflow = self._build_graph()
        self.memory = MemorySaver()
        self.app = self.workflow.compile(checkpointer=self.memory)

    def extract_task_info(self, user_input: str) -> Dict[str, Any]:
        """Extract task information from natural language input."""
        extraction_prompt = ChatPromptTemplate.from_messages([
            ("system", """You are an expert task extraction system. Extract task information from the user's natural language input.

            Current date: {current_date}

            Rules for extraction:
            1. Extract a clear, concise task title
            2. Identify any due dates (convert relative dates like 'tomorrow', 'next week' to absolute dates)
            3. Identify any due times
            4. Determine priority if mentioned (high, medium, low)
            5. Identify reminder frequency if mentioned (daily, weekly, monthly)
            6. Set needs_clarification to true if the task is too vague or ambiguous
            7. Generate a clarification question if needed

            Return valid JSON only."""),
            ("human", "Extract task information from: {user_input}")
        ])

        parser = JsonOutputParser(pydantic_object=TaskExtraction)
        chain = extraction_prompt | self.llm | parser

        try:
            current_date = datetime.now().strftime("%Y-%m-%d")
            result = chain.invoke({
                "user_input": user_input,
                "current_date": current_date
            })
            return result
        except Exception as e:
            return {
                "title": user_input[:50],
                "needs_clarification": True,
                "clarification_question": "Could you provide more details about this task?"
            }

    def _build_graph(self) -> StateGraph:
        """Build the LangGraph workflow."""
        workflow = StateGraph(AgentState)

        # Add nodes
        workflow.add_node("router", self._route_message)
        workflow.add_node("task_creation", self._handle_task_creation)
        workflow.add_node("task_management", self._handle_task_management)
        workflow.add_node("general_chat", self._handle_general_chat)
        workflow.add_node("clarification", self._handle_clarification)

        # Set entry point
        workflow.set_entry_point("router")

        # Add edges
        workflow.add_conditional_edges(
            "router",
            self._route_decision,
            {
                "task_creation": "task_creation",
                "task_management": "task_management",
                "general_chat": "general_chat",
                "clarification": "clarification"
            }
        )

        workflow.add_edge("task_creation", END)
        workflow.add_edge("task_management", END)
        workflow.add_edge("general_chat", END)
        workflow.add_edge("clarification", END)

        return workflow

    def _route_message(self, state: AgentState) -> AgentState:
        """Route the incoming message to the appropriate handler."""
        return state

    def _route_decision(self, state: AgentState) -> str:
        """Decide which node to route to based on the message."""
        if state.get("awaiting_clarification"):
            return "clarification"

        last_message = state["messages"][-1].content.lower()

        # Task creation patterns
        creation_patterns = [
            r"remind me", r"create.*task", r"add.*task", r"schedule", 
            r"need to", r"have to", r"don't forget", r"i need help creating"
        ]

        # Task management patterns
        management_patterns = [
            r"list.*task", r"show.*task", r"my tasks", r"complete.*task",
            r"delete.*task", r"update.*task", r"mark.*complete", r"task.*\d+"
        ]

        for pattern in creation_patterns:
            if re.search(pattern, last_message):
                return "task_creation"

        for pattern in management_patterns:
            if re.search(pattern, last_message):
                return "task_management"

        return "general_chat"

    def _handle_task_creation(self, state: AgentState) -> AgentState:
        """Handle task creation requests."""
        user_input = state["messages"][-1].content
        user_id = state["user_id"]

        # Extract task information
        extraction_result = self.extract_task_info(user_input)

        if extraction_result.get("needs_clarification"):
            # Need clarification
            clarification_msg = extraction_result.get(
                "clarification_question", 
                "Could you provide more details about this task?"
            )

            response = AIMessage(content=clarification_msg)
            state["messages"].append(response)
            state["awaiting_clarification"] = True
            state["clarification_context"] = extraction_result

        else:
            # Create the task
            result = self.task_manager.create_task(
                user_id=user_id,
                title=extraction_result["title"],
                description=extraction_result.get("description", ""),
                due_date=extraction_result.get("due_date", ""),
                due_time=extraction_result.get("due_time", ""),
                priority=extraction_result.get("priority", "medium"),
                reminder_frequency=extraction_result.get("reminder_frequency", "")
            )

            response = AIMessage(content=result)
            state["messages"].append(response)
            state["last_action"] = "task_created"

        return state

    def _handle_task_management(self, state: AgentState) -> AgentState:
        """Handle task management requests."""
        user_input = state["messages"][-1].content.lower()
        user_id = state["user_id"]

        # Determine the management action
        if "list" in user_input or "show" in user_input or "my tasks" in user_input:
            result = self.task_manager.list_tasks(user_id=user_id)

        elif "complete" in user_input or "mark" in user_input:
            # Extract task ID
            task_id_match = re.search(r'(?:task\s+|id[:\s]+)([a-f0-9]{8})', user_input)
            if task_id_match:
                task_id = task_id_match.group(1)
                result = self.task_manager.complete_task(user_id=user_id, task_id=task_id)
            else:
                result = "❌ Please specify the task ID. You can get it by listing your tasks first."

        elif "delete" in user_input:
            # Extract task ID
            task_id_match = re.search(r'(?:task\s+|id[:\s]+)([a-f0-9]{8})', user_input)
            if task_id_match:
                task_id = task_id_match.group(1)
                result = self.task_manager.delete_task(user_id=user_id, task_id=task_id)
            else:
                result = "❌ Please specify the task ID. You can get it by listing your tasks first."

        else:
            # Check for task ID in the message for details
            task_id_match = re.search(r'([a-f0-9]{8})', user_input)
            if task_id_match:
                task_id = task_id_match.group(1)
                result = self.task_manager.get_task_details(user_id=user_id, task_id=task_id)
            else:
                result = self.task_manager.list_tasks(user_id=user_id)

        response = AIMessage(content=result)
        state["messages"].append(response)
        state["last_action"] = "task_managed"

        return state

    def _handle_clarification(self, state: AgentState) -> AgentState:
        """Handle clarification responses."""
        user_response = state["messages"][-1].content
        user_id = state["user_id"]
        context = state.get("clarification_context", {})

        # Update the task info with clarification
        updated_info = self.extract_task_info(user_response)

        # Merge with original context
        final_task_info = {**context, **updated_info}

        if updated_info.get("needs_clarification"):
            # Still need more clarification
            clarification_msg = updated_info.get(
                "clarification_question",
                "I still need a bit more information. Could you be more specific?"
            )
            response = AIMessage(content=clarification_msg)
            state["messages"].append(response)
            state["clarification_context"] = final_task_info
        else:
            # Create the task
            result = self.task_manager.create_task(
                user_id=user_id,
                title=final_task_info["title"],
                description=final_task_info.get("description", ""),
                due_date=final_task_info.get("due_date", ""),
                due_time=final_task_info.get("due_time", ""),
                priority=final_task_info.get("priority", "medium"),
                reminder_frequency=final_task_info.get("reminder_frequency", "")
            )

            response = AIMessage(content=result)
            state["messages"].append(response)
            state["awaiting_clarification"] = False
            state["clarification_context"] = None
            state["last_action"] = "task_created"

        return state

    def _handle_general_chat(self, state: AgentState) -> AgentState:
        """Handle general conversation and help."""
        user_input = state["messages"][-1].content.lower()

        if "help" in user_input or "commands" in user_input:
            help_text = """
🤖 **Copilot Help - What I Can Do:**

**📋 Task Management:**
• "Remind me to buy groceries tomorrow"
• "Create a task to call John at 3 PM"
• "Schedule Twitter space for next week"
• "List my tasks" or "Show my tasks"
• "Complete task [task_id]"
• "Delete task [task_id]"

**💡 Natural Language Examples:**
• "Don't forget to buy ETH on Sunday"
• "I need to prepare for the meeting tomorrow at 10 AM"
• "Schedule a daily reminder to check emails"

**🎯 Task Features:**
• Smart date/time extraction
• Priority levels (high, medium, low)
• Recurring reminders (daily, weekly, monthly)
• Task IDs for easy management

**🔧 Commands:**
• `/help` - Show this help
• `/tasks` - List all tasks
• `/support` - Get support

Just talk to me naturally! I'll understand what you want to do. 😊
            """

        elif "support" in user_input:
            help_text = """
🆘 **Support & Community:**

• **Report Issues:** Contact our support team
• **Join Community:** Connect with other users
• **Feature Requests:** Let us know what you'd like to see

I'm here to help with your task management needs! 🚀
            """

        else:
            # General conversational response
            chat_prompt = ChatPromptTemplate.from_messages([
                ("system", """You are Copilot, a helpful AI assistant focused on task management and productivity. 
                You're integrated into a Telegram bot and help users manage their tasks efficiently.

                Be friendly, concise, and always try to relate responses back to how you can help with tasks or productivity.
                If the user seems to be describing something that could be a task, gently suggest creating one.

                Keep responses short and engaging, suitable for a chat interface."""),
                ("human", "{user_input}")
            ])

            chain = chat_prompt | self.llm
            ai_response = chain.invoke({"user_input": state["messages"][-1].content})
            help_text = ai_response.content

        response = AIMessage(content=help_text)
        state["messages"].append(response)
        state["last_action"] = "general_chat"

        return state

    async def process_message(self, user_id: str, message: str) -> str:
        """Process a user message and return the bot response."""
        # Initialize state
        initial_state = {
            "messages": [HumanMessage(content=message)],
            "user_id": user_id,
            "current_task": None,
            "awaiting_clarification": False,
            "clarification_context": None,
            "last_action": None
        }

        # Check if user has ongoing clarification
        if user_id in self.user_contexts:
            context = self.user_contexts[user_id]
            initial_state["awaiting_clarification"] = context.get("awaiting_clarification", False)
            initial_state["clarification_context"] = context.get("clarification_context")

        # Process through the graph
        config = {"configurable": {"thread_id": user_id}}
        result = await self.app.ainvoke(initial_state, config)

        # Save user context
        self.user_contexts[user_id] = {
            "awaiting_clarification": result.get("awaiting_clarification", False),
            "clarification_context": result.get("clarification_context"),
            "last_action": result.get("last_action")
        }

        # Return the AI response
        return result["messages"][-1].content

# Usage example and main function
async def main():
    """Example usage of the Copilot Agent."""
    # Initialize the agent (replace with your actual Gemini API key)
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "your-gemini-api-key-here")

    if GEMINI_API_KEY == "your-gemini-api-key-here":
        print("❌ Please set your GEMINI_API_KEY environment variable")
        print("   export GEMINI_API_KEY='your-actual-api-key'")
        return

    agent = CopilotAgent(GEMINI_API_KEY)

    # Simulate user interactions
    user_id = "user123"

    test_messages = [
        "Hi, I need help creating a task",
        "Schedule Twitter space",
        "yes, that's fine with daily reminders",
        "remind me to buy eth on Sunday",
        "list my tasks",
    ]

    print("🤖 Copilot Agent Demo")
    print("=" * 50)

    for message in test_messages:
        print(f"\n👤 User: {message}")
        try:
            response = await agent.process_message(user_id, message)
            print(f"🤖 Copilot: {response}")
        except Exception as e:
            print(f"❌ Error: {e}")

        # Small delay to simulate real conversation
        await asyncio.sleep(1)

# Telegram Bot Integration Example
def create_telegram_bot(agent: CopilotAgent):
    """Example of how to integrate with python-telegram-bot"""
    try:
        from telegram import Update
        from telegram.ext import Application, MessageHandler, filters, ContextTypes

        async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
            user_id = str(update.effective_user.id)
            message = update.message.text

            try:
                response = await agent.process_message(user_id, message)
                # Escape markdown characters for Telegram
                escaped_response = response.replace('_', '\\_').replace('*', '\\*').replace('[', '\\[').replace(']', '\\]')
                await update.message.reply_text(escaped_response, parse_mode='MarkdownV2')
            except Exception as e:
                await update.message.reply_text(f"Sorry, I encountered an error: {str(e)}")

        # Create application
        app = Application.builder().token(os.getenv.("TELEGRAM_BOT_TOKEN", "YOUR_TELEGRAM_BOT_TOKEN")).build()

        # Add message handler
        app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

        return app

    except ImportError:
        print("python-telegram-bot not installed. Run: pip install python-telegram-bot")
        return None

# Flask Web Interface Example
def create_web_interface(agent: CopilotAgent):
    """Example of how to create a simple web interface"""
    try:
        from flask import Flask, request, jsonify, render_template_string

        app = Flask(__name__)

        @app.route('/')
        def home():
            return render_template_string("""
            <!DOCTYPE html>
            <html>
            <head>
                <title>Copilot Agent</title>
                <style>
                    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
                    .chat-container { border: 1px solid #ddd; height: 400px; overflow-y: scroll; padding: 10px; margin-bottom: 10px; }
                    .message { margin-bottom: 10px; }
                    .user { color: blue; }
                    .bot { color: green; }
                    input[type="text"] { width: 80%; padding: 10px; }
                    button { padding: 10px 20px; }
                </style>
            </head>
            <body>
                <h1>🤖 Copilot Agent</h1>
                <div id="chat" class="chat-container"></div>
                <input type="text" id="message" placeholder="Type your message..." onkeypress="if(event.key==='Enter') sendMessage()">
                <button onclick="sendMessage()">Send</button>

                <script>
                    async function sendMessage() {
                        const input = document.getElementById('message');
                        const message = input.value.trim();
                        if (!message) return;

                        addMessage('user', message);
                        input.value = '';

                        try {
                            const response = await fetch('/chat', {
                                method: 'POST',
                                headers: {'Content-Type': 'application/json'},
                                body: JSON.stringify({message: message, user_id: 'web_user'})
                            });
                            const data = await response.json();
                            addMessage('bot', data.response);
                        } catch (error) {
                            addMessage('bot', 'Error: ' + error.message);
                        }
                    }

                    function addMessage(sender, text) {
                        const chat = document.getElementById('chat');
                        const div = document.createElement('div');
                        div.className = 'message ' + sender;
                        div.innerHTML = '<strong>' + (sender === 'user' ? 'You' : 'Copilot') + ':</strong> ' + text;
                        chat.appendChild(div);
                        chat.scrollTop = chat.scrollHeight;
                    }
                </script>
            </body>
            </html>
            """)

        @app.route('/chat', methods=['POST'])
        async def chat():
            data = request.json
            message = data.get('message', '')
            user_id = data.get('user_id', 'web_user')

            try:
                response = await agent.process_message(user_id, message)
                return jsonify({'response': response})
            except Exception as e:
                return jsonify({'error': str(e)}), 500

        return app

    except ImportError:
        print("Flask not installed. Run: pip install flask")
        return None

if __name__ == "__main__":
    # Choose how to run the agent
    import sys

    if len(sys.argv) > 1:
        mode = sys.argv[1]

        if mode == "demo":
            # Run the demo
            asyncio.run(main())

        elif mode == "telegram":
            # Run Telegram bot
            GEMINI_API_KEY = "AIzaSyBieRiyDNKZD9rfqFqh2gB1_MoE9yQhm6A"
            if not GEMINI_API_KEY:
                print("❌ Please set GEMINI_API_KEY environment variable")
                sys.exit(1)

            agent = CopilotAgent(GEMINI_API_KEY)
            telegram_app = create_telegram_bot(agent)

            if telegram_app:
                print("🚀 Starting Telegram bot...")
                telegram_app.run_polling()

        elif mode == "web":
            # Run web interface
            GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
            if not GEMINI_API_KEY:
                print("❌ Please set GEMINI_API_KEY environment variable")
                sys.exit(1)

            agent = CopilotAgent(GEMINI_API_KEY)
            web_app = create_web_interface(agent)

            if web_app:
                print("🌐 Starting web interface at http://localhost:5000")
                web_app.run(debug=True)

        else:
            print("Usage: python agent.py [demo|telegram|web]")

    else:
        print("🤖 Copilot Agent")
        print("Usage: python agent.py [demo|telegram|web]")
        print()
        print("Modes:")
        print("  demo     - Run interactive demo")
        print("  telegram - Run as Telegram bot")
        print("  web      - Run web interface")
        print()
        print("Environment Variables:")
        print("  GEMINI_API_KEY - Your Google Gemini API key")
        print("  TELEGRAM_BOT_TOKEN - Your Telegram bot token (for telegram mode)")