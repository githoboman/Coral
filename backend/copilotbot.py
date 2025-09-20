from parsedatetime import Calendar
from typing import Final
from web3 import Web3
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes, CallbackQueryHandler
import os
from dotenv import load_dotenv
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from ai.agent import CopilotAgent  # Import CopilotAgent from ai/agent.py
from supabase import create_client, Client
import asyncio
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

# Load environment variables from .env file
load_dotenv()

# Get the token and API keys from environment variables
TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
INFURA_PROJECT_ID = os.getenv("INFURA_PROJECT_ID")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

# Check if required tokens are loaded
if not TOKEN:
    raise ValueError('TELEGRAM_BOT_TOKEN must be set')
if not GEMINI_API_KEY:
    raise ValueError('GEMINI_API_KEY must be set')
if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError('SUPABASE_URL and SUPABASE_KEY must be set')

BOT_USERNAME: Final = '@CopilotScheduler_bot'

# Configure logging to save to copilot.log
os.makedirs('logs', exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('logs/copilot.log'),
        logging.StreamHandler()
    ]
)

logger = logging.getLogger(__name__)

# Custom handler to filter httpx logs and redact tokens
class TokenFilter(logging.Filter):
    def filter(self, record):
        if hasattr(record, 'msg'):
            original_msg = str(record.msg)
            if 'api.telegram.org/bot' in original_msg and TOKEN in original_msg:
                modified_msg = original_msg.replace(TOKEN, '[REDACTED]')
                record.msg = modified_msg
        return True

# Hard-disable httpx/httpcore request logging to prevent token leakage
httpx_loggers = [
    'httpx',
    'httpx._client', 
    'httpcore',
    'httpcore.http11',
    'httpcore.connection',
    'httpcore.http2',
    'httpcore.proxy'
]

for logger_name in httpx_loggers:
    httpx_logger = logging.getLogger(logger_name)
    httpx_logger.disabled = True  # Completely disable these loggers
    httpx_logger.propagate = False  # Prevent propagation to root logger

# Add robust token filter to root logger as backstop
class RobustTokenFilter(logging.Filter):
    def filter(self, record):
        if TOKEN and hasattr(record, 'msg') and record.msg:
            # Handle both msg and args for comprehensive redaction
            message = record.getMessage() if hasattr(record, 'getMessage') else str(record.msg)
            if TOKEN in message:
                record.msg = message.replace(TOKEN, '[REDACTED]')
                record.args = None
        return True

# Apply robust filter to root logger as additional safety
logging.getLogger().addFilter(RobustTokenFilter())

# Initialize Supabase client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Initialize enhanced CopilotAgent with Supabase
agent = CopilotAgent(GEMINI_API_KEY, supabase)
print("Bot starting with enhanced agent, Supabase integration, and AI attribute generation")

# Helper function to escape MarkdownV2 characters
def escape_markdown_v2(text: str) -> str:
    """Escape special characters for MarkdownV2 parsing."""
    markdown_chars = ['_', '*', '[', ']', '(', ')', '~', '`', '#', '+', '-', '=', '|', '{', '}', '.', '!']
    escaped_text = text
    for char in markdown_chars:
        escaped_text = escaped_text.replace(char, f'\\{char}')
    return escaped_text

# Enhanced database operations
async def create_user_profile(user_id: str, username: str = None, first_name: str = None):
    """Create or update user profile in Supabase."""
    try:
        user_data = {
            'user_id': user_id,
            'username': username,
            'first_name': first_name,
            'created_at': datetime.now().isoformat(),
            'last_active': datetime.now().isoformat(),
            'timezone': 'UTC'  # Default to UTC, can be updated by user
        }

        # Use upsert to handle existing users
        supabase.table('user_profiles').upsert(user_data, on_conflict='user_id').execute()
        logger.info(f"User profile created/updated for user: {user_id}")
    except Exception as e:
        logger.error(f"Error creating user profile: {e}")

async def update_user_activity(user_id: str):
    """Update user's last activity timestamp."""
    try:
        supabase.table('user_profiles').update({
            'last_active': datetime.now().isoformat()
        }).eq('user_id', user_id).execute()
    except Exception as e:
        logger.error(f"Error updating user activity: {e}")

# Scheduler for sending reminders
async def send_reminders(app: Application):
    """Check for due reminders and send them to users via Telegram."""
    try:
        # Query unsent reminders that are due
        current_time_utc = datetime.now(ZoneInfo('UTC')).isoformat()
        reminders_response = supabase.table('task_reminders')\
            .select('id, task_id, user_id, reminder_time')\
            .eq('is_sent', False)\
            .lte('reminder_time', current_time_utc)\
            .execute()

        reminders = reminders_response.data
        if not reminders:
            logger.debug("No due reminders found.")
            return

        for reminder in reminders:
            user_id = reminder['user_id']
            task_id = reminder['task_id']
            
            # Get task details separately
            task_response = supabase.table('tasks').select('task_name, is_recurring').eq('id', task_id).execute()
            if not task_response.data:
                logger.warning(f"Task {task_id} not found for reminder {reminder['id']}")
                continue
                
            task_name = task_response.data[0]['task_name']
            is_recurring = task_response.data[0]['is_recurring']
            reminder_time = datetime.fromisoformat(reminder['reminder_time'])

            # Fetch user's timezone
            user_response = supabase.table('user_profiles').select('timezone').eq('user_id', user_id).execute()
            user_timezone = user_response.data[0].get('timezone', 'UTC') if user_response.data else 'UTC'
            tz = ZoneInfo(user_timezone)

            # Format reminder time in user's timezone
            reminder_time_local = reminder_time.astimezone(tz)
            reminder_message = f"⏰ *Reminder:* It's time to *{task_name}* at {reminder_time_local.strftime('%H:%M')}!"

            # Send reminder via Telegram
            try:
                escaped_message = escape_markdown_v2(reminder_message)
                await app.bot.send_message(
                    chat_id=user_id,
                    text=escaped_message,
                    parse_mode='MarkdownV2'
                )
                logger.info(f"Sent reminder for task {task_id} to user {user_id}")
            except Exception as e:
                logger.error(f"Failed to send reminder to user {user_id} for task {task_id}: {e}")
                continue

            # Mark reminder as sent
            try:
                supabase.table('task_reminders')\
                    .update({'is_sent': True})\
                    .eq('id', reminder['id'])\
                    .execute()
                logger.info(f"Marked reminder {reminder['id']} as sent for task {task_id}")
            except Exception as e:
                logger.error(f"Error marking reminder {reminder['id']} as sent: {e}")

            # Handle recurring tasks
            if is_recurring:
                try:
                    # Fetch current reminder_times from tasks
                    task_response = supabase.table('tasks').select('reminder_times').eq('id', task_id).eq('user_id', user_id).execute()
                    if not task_response.data:
                        logger.error(f"Task {task_id} not found for user {user_id}")
                        continue

                    current_reminder_times = task_response.data[0].get('reminder_times', [])
                    new_reminder_times = []

                    # Calculate next occurrence for each reminder time
                    for rt in current_reminder_times:
                        rt_dt = datetime.fromisoformat(rt)
                        # Example: For daily recurrence, add one day
                        next_time = rt_dt + timedelta(days=1)  # Assuming daily recurrence for simplicity
                        new_reminder_times.append(next_time.isoformat())

                    # Update task with new reminder_times
                    supabase.table('tasks')\
                        .update({
                            'reminder_times': new_reminder_times,
                            'updated_at': datetime.now(tz).isoformat()
                        })\
                        .eq('id', task_id)\
                        .execute()

                    # Insert new reminders for the next occurrence
                    for new_time in new_reminder_times:
                        reminder_data = {
                            'task_id': task_id,
                            'user_id': user_id,
                            'reminder_time': new_time,
                            'reminder_type': 'recurring',
                            'is_sent': False,
                            'created_at': datetime.now(tz).isoformat()
                        }
                        supabase.table('task_reminders').insert(reminder_data).execute()
                    logger.info(f"Updated recurring reminders for task {task_id}")
                except Exception as e:
                    logger.error(f"Error updating recurring reminders for task {task_id}: {e}")

    except Exception as e:
        logger.error(f"Error in send_reminders: {e}")

# Commands
async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /start command with user profile creation."""
    user = update.effective_user
    user_id = str(user.id)

    # Create user profile
    await create_user_profile(user_id, user.username, user.first_name)

    message = (
        "*Welcome to Copilot*\n"
        "I'm your intelligent task management assistant\\! I can help you:\n\n"
        "✨ Create tasks with natural language\n"
        "📅 Set smart reminders and due dates\n"
        "🏷️ Auto\\-generate tags and descriptions\n"
        "🎯 Prioritize your tasks automatically\n"
        "📊 Track your productivity\n\n"
        "*Quick Start:*\n"
        "• Type */new\\_task* to create your first task\\!\n"
        "• Use */help* for more commands\\.\n"
        "• Just talk naturally \\- I understand\\!\n\n"
        "*Try saying:* \"Remind me to buy groceries tomorrow at 3 PM\""
    )

    logger.info(f"Start command for user: {user_id}")
    try:
        await update.message.reply_text(message, parse_mode='MarkdownV2')
    except Exception as e:
        logger.error(f'Error in start_command: {e}')
        await update.message.reply_text("Welcome to Copilot! I'm here to help you manage your tasks efficiently.")

async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Enhanced help command with inline keyboard."""
    user_id = str(update.effective_user.id)
    await update_user_activity(user_id)

    message = (
        "*Copilot Help \\- What I Can Do:*\n\n"
        "*📋 Task Management:*\n"
        "• */start* \\- Welcome and introduction\n"
        "• */new\\_task* \\- Create a new task\n"
        "• */tasks* \\- View all your tasks\n"
        "• */settimezone* \\- Set your timezone for reminders\n"
        "• */help* \\- Show this help\n"
        "• */web3query* \\- Search Web3 information\n\n"
        "*💡 Natural Language Examples:*\n"
        "• \"Remind me to buy ETH on Sunday\"\n"
        "• \"Schedule team meeting tomorrow at 2 PM\"\n"
        "• \"Create high priority task to review code\"\n"
        "• \"List my pending tasks\"\n"
        "• \"Complete task 123\"\n"
        "• \"Delete task 456\"\n\n"
        "*🎯 Smart Features:*\n"
        "• Auto\\-generated descriptions and tags\n"
        "• Smart priority detection\n"
        "• Natural date/time parsing\n"
        "• Intelligent clarification \\(max 4 steps\\)\n"
        "• Supabase cloud storage\n\n"
        "*Just talk naturally \\- I'll understand\\!* 😊"
    )

    keyboard = [
        [InlineKeyboardButton('📝 Create Task', callback_data='help_create_task')],
        [InlineKeyboardButton('📋 View Tasks', callback_data='help_view_tasks')],
        [InlineKeyboardButton('💬 Contact Support', url="https://t.me/YourSupportChannel")],
        [InlineKeyboardButton('🌐 Join Community', url="https://t.me/YourCommunityChannel")],
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)

    try:
        await update.message.reply_text(message, parse_mode='MarkdownV2', reply_markup=reply_markup)
    except Exception as e:
        logger.error(f'Error in help_command: {e}')
        await update.message.reply_text("I can help you manage tasks efficiently! Use /start to learn more.")

async def set_timezone_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Allow users to set their timezone."""
    user_id = str(update.effective_user.id)
    await update_user_activity(user_id)

    try:
        args = context.args
        if not args:
            message = (
                "*Set Your Timezone*\n\n"
                "Please provide a timezone (e.g., 'Africa/Lagos', 'America/New_York'):\n"
                "• Example: /settimezone Africa/Lagos\n"
                "• Use standard TZ database names (e.g., from zoneinfo.available_timezones())"
            )
            escaped_message = escape_markdown_v2(message)
            await update.message.reply_text(escaped_message, parse_mode='MarkdownV2')
            return

        timezone = args[0]
        try:
            ZoneInfo(timezone)  # Validate timezone
        except Exception:
            message = f"❌ Invalid timezone: {timezone}. Please use a valid TZ database name (e.g., 'Africa/Lagos')."
            escaped_message = escape_markdown_v2(message)
            await update.message.reply_text(escaped_message, parse_mode='MarkdownV2')
            return

        # Update user profile
        supabase.table('user_profiles').update({
            'timezone': timezone,
            'last_active': datetime.now().isoformat()
        }).eq('user_id', user_id).execute()

        message = f"✅ Timezone set to *{timezone}*. Your reminders will now use this timezone!"
        escaped_message = escape_markdown_v2(message)
        await update.message.reply_text(escaped_message, parse_mode='MarkdownV2')
        logger.info(f"User {user_id} set timezone to {timezone}")

    except Exception as e:
        logger.error(f'Error in set_timezone_command: {e}')
        await update.message.reply_text(f"Sorry, I encountered an error setting your timezone: {str(e)}")

async def new_task_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Enhanced new task command that uses the agent."""
    user_id = str(update.effective_user.id)
    await update_user_activity(user_id)

    try:
        args = context.args
        if not args:
            message = (
                "*Let's make a new task!*\n\n"
                "💡 Just type what you need to do, for example:\n"
                "• Buy groceries tomorrow at 5 PM\n"
                "• Review project proposal by Friday\n"
                "• Daily reminder to take vitamins\n\n"
                "I’ll detect dates, priorities, and reminders automatically!"
            )
            escaped_message = escape_markdown_v2(message)
            await update.message.reply_text(escaped_message, parse_mode="MarkdownV2")
            return

        # Use the agent to process task creation
        task_input = " ".join(args)
        response = await agent.process_message(user_id, f"create task: {task_input}")

        escaped_response = escape_markdown_v2(response)
        await update.message.reply_text(escaped_response, parse_mode='MarkdownV2')

        logger.info(f"Task created via /new_task for user: {user_id}")

    except Exception as e:
        logger.error(f'Error in new_task_command: {e}')
        await update.message.reply_text(f"Sorry, I encountered an error creating your task: {str(e)}")

async def tasks_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Enhanced tasks command with better UI."""
    user_id = str(update.effective_user.id)
    await update_user_activity(user_id)

    try:
        # Use the agent to list tasks
        response = await agent.process_message(user_id, "list my tasks")

        # Fetch tasks directly for button creation
        task_response = supabase.table('tasks').select('*').eq('user_id', user_id).eq('status', 'pending').execute()
        tasks = task_response.data

        keyboard = []
        if tasks:
            # Add quick action buttons for first few tasks
            for task in tasks[:3]:  # Show buttons for first 3 tasks
                task_id = task['id']
                task_name = task['task_name'][:20] + "..." if len(task['task_name']) > 20 else task['task_name']
                keyboard.append([
                    InlineKeyboardButton(f"✅ Complete: {task_name}", callback_data=f"complete_{task_id}"),
                ])

            # Add general action buttons
            keyboard.extend([
                [
                    InlineKeyboardButton("📊 View All", callback_data="view_all_tasks"),
                    InlineKeyboardButton("➕ New Task", callback_data="create_new_task")
                ],
                [
                    InlineKeyboardButton("✅ Completed", callback_data="view_completed"),
                    InlineKeyboardButton("🗑️ Manage", callback_data="manage_tasks")
                ]
            ])
        else:
            keyboard = [
                [InlineKeyboardButton("➕ Create Your First Task", callback_data="create_new_task")]
            ]

        reply_markup = InlineKeyboardMarkup(keyboard) if keyboard else None
        escaped_response = escape_markdown_v2(response)

        await update.message.reply_text(escaped_response, parse_mode='MarkdownV2', reply_markup=reply_markup)

    except Exception as e:
        logger.error(f'Error in tasks_command: {e}')
        await update.message.reply_text(f"Sorry, I encountered an error fetching your tasks: {str(e)}")

async def button_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Enhanced callback handler for inline buttons."""
    query = update.callback_query
    user_id = str(query.from_user.id)
    await query.answer()

    try:
        callback_data = query.data

        if callback_data.startswith("complete_"):
            task_id = callback_data.split("_", 1)[1]
            response = await agent.process_message(user_id, f"complete task {task_id}")
            escaped_response = escape_markdown_v2(response)
            await query.edit_message_text(escaped_response, parse_mode='MarkdownV2')

        elif callback_data == "create_new_task":
            message = "What task would you like to create? Just tell me naturally!"
            await query.edit_message_text(message)

        elif callback_data == "view_all_tasks":
            response = await agent.process_message(user_id, "list all my tasks")
            escaped_response = escape_markdown_v2(response)
            await query.edit_message_text(escaped_response, parse_mode='MarkdownV2')

        elif callback_data == "view_completed":
            # Get completed tasks
            task_response = supabase.table('tasks').select('*').eq('user_id', user_id).eq('status', 'completed').execute()
            tasks = task_response.data

            if tasks:
                message = "*✅ Completed Tasks:*\n\n"
                for task in tasks[-10:]:  # Show last 10 completed
                    completed_date = datetime.fromisoformat(task.get('updated_at', task['created_at']).replace('Z', '+00:00'))
                    message += f"• {task['task_name']} \\(completed {completed_date.strftime('%m/%d')}\\)\n"
            else:
                message = "*No completed tasks yet\\.*\nKeep working \\- you got this\\! 💪"

            await query.edit_message_text(message, parse_mode='MarkdownV2')

        elif callback_data.startswith("hitl_"):
            # Handle HITL (Human-in-the-Loop) confirmation buttons
            if callback_data.startswith("hitl_confirm:"):
                draft_ids = callback_data.split(":", 1)[1]
                # Use the specific draft IDs from callback data for better reliability
                response = await agent.process_message(user_id, f"confirm drafts {draft_ids}")
                escaped_response = escape_markdown_v2(response)
                prefix_text = escape_markdown_v2("✅ Tasks Confirmed!\n\n")
                await query.edit_message_text(f"{prefix_text}{escaped_response}", parse_mode='MarkdownV2')
                
            elif callback_data.startswith("hitl_cancel:"):
                draft_ids = callback_data.split(":", 1)[1]
                # Use the specific draft IDs from callback data for better reliability  
                response = await agent.process_message(user_id, f"cancel drafts {draft_ids}")
                escaped_response = escape_markdown_v2(response)
                prefix_text = escape_markdown_v2("❌ Tasks Cancelled\n\n")
                await query.edit_message_text(f"{prefix_text}{escaped_response}", parse_mode='MarkdownV2')
                
            elif callback_data.startswith("hitl_edit:"):
                parts = callback_data.split(":", 2)
                draft_id = parts[1]
                task_num = parts[2]
                
                # Prompt user for edit instructions
                message = f"*✏️ Edit Task {task_num}*\n\nPlease reply with your changes for this task\\.\n\n*Example:* \"edit {task_num}: change time to 9 AM\""
                await query.edit_message_text(message, parse_mode='MarkdownV2')
                
            elif callback_data.startswith("hitl_edit_more:"):
                draft_ids = callback_data.split(":", 1)[1].split(",")
                message = "*✏️ More Edit Options*\n\n"
                for i, draft_id in enumerate(draft_ids, 4):  # Start from 4 since first 3 are already shown
                    message += f"• Type \"edit {i}: \\[changes\\]\" for Task {i}\n"
                message += "\n*Example:* \"edit 4: change priority to high\""
                await query.edit_message_text(message, parse_mode='MarkdownV2')

        elif callback_data.startswith("help_"):
            if callback_data == "help_create_task":
                message = (
                    "*Creating Tasks is Easy\\!*\n\n"
                    "Just tell me naturally what you need to do:\n"
                    "• \"Remind me to call John tomorrow\"\n"
                    "• \"High priority: finish report by Friday\"\n"
                    "• \"Weekly reminder to check emails\"\n\n"
                    "I'll understand dates, priorities, and create helpful descriptions automatically\\!"
                )
                await query.edit_message_text(message, parse_mode='MarkdownV2')
            elif callback_data == "help_view_tasks":
                message = (
                    "*Managing Your Tasks:*\n\n"
                    "• Use */tasks* to see all pending tasks\n"
                    "• Say \"complete task \\[ID\\]\" to mark done\n"
                    "• Say \"delete task \\[ID\\]\" to remove\n"
                    "• Use buttons for quick actions\n\n"
                    "Task IDs are shown next to each task\\!"
                )
                await query.edit_message_text(message, parse_mode='MarkdownV2')

    except Exception as e:
        logger.error(f'Error in button_callback: {e}')
        await query.edit_message_text(f"Sorry, I encountered an error: {str(e)}")

async def web3query_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Enhanced Web3 query command."""
    user_id = str(update.effective_user.id)
    await update_user_activity(user_id)

    try:
        args = context.args
        if not args:
            message = (
                "*Web3 Information Search*\n\n"
                "💡 *What Web3 data are you looking for?*\n"
                "• \"ETH balance of 0x123\\.\\.\\.ABC\"\n"
                "• \"Current price of SOL\"\n"
                "• \"Gas fees on Ethereum\"\n\n"
                "*Note:* This feature uses Infura for blockchain data\\."
            )
            escaped_message = escape_markdown_v2(message)
            await update.message.reply_text(escaped_message, parse_mode='MarkdownV2')
            return

        query_text = " ".join(args).lower()

        if INFURA_PROJECT_ID:
            w3 = Web3(Web3.HTTPProvider(f'https://mainnet.infura.io/v3/{INFURA_PROJECT_ID}'))

            if "eth balance" in query_text and "0x" in query_text:
                # Extract address
                address_match = re.search(r'0x[a-fA-F0-9]{40}', query_text)
                if address_match:
                    address = address_match.group(0)
                    balance = w3.eth.get_balance(Web3.to_checksum_address(address))
                    eth_balance = Web3.from_wei(balance, 'ether')
                    message = f"*ETH Balance:*\n`{address}`\n\n💰 **{eth_balance:.4f} ETH**"
                else:
                    message = "❌ Invalid Ethereum address format. Please provide a valid 0x address."

            elif "gas" in query_text:
                try:
                    gas_price = w3.eth.gas_price
                    gas_gwei = Web3.from_wei(gas_price, 'gwei')
                    message = f"⛽ **Current Gas Price:** {gas_gwei:.2f} Gwei"
                except:
                    message = "❌ Unable to fetch current gas prices."

            elif "block" in query_text:
                try:
                    latest_block = w3.eth.block_number
                    message = f"🔗 **Latest Block Number:** {latest_block:,}"
                except:
                    message = "❌ Unable to fetch latest block information."

            else:
                message = (
                    "*Available Web3 Queries:*\n"
                    "• ETH balance of \\[address\\]\n"
                    "• Current gas fees\n"
                    "• Latest block number\n\n"
                    "*More features coming soon\\!*"
                )
        else:
            message = "❌ Web3 functionality requires Infura configuration."

        escaped_message = escape_markdown_v2(message)
        await update.message.reply_text(escaped_message, parse_mode='MarkdownV2')

    except Exception as e:
        logger.error(f'Error in web3query_command: {e}')
        await update.message.reply_text(f"Sorry, I encountered an error with the Web3 query: {str(e)}")

# Enhanced message handler using CopilotAgent
async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Enhanced message handler with better natural language processing."""
    message_type: str = update.message.chat.type
    text: str = update.message.text
    user = update.effective_user
    user_id = str(user.id)

    # Update user activity
    await update_user_activity(user_id)

    logger.info(f"User {user.first_name} ({user_id}) in {message_type}: '{text}'")

    # Handle group messages with bot mention
    if message_type == 'group':
        if BOT_USERNAME in text:
            new_text: str = text.replace(BOT_USERNAME, "").strip()
        else:
            return
    else:
        new_text = text

    try:
        # Let the agent process the message directly
        response = await agent.process_message(user_id, new_text)

        # Check for HITL buttons marker
        reply_markup = None
        if '[HITL_BUTTONS:' in response:
            # Extract draft IDs from marker
            marker_start = response.find('[HITL_BUTTONS:') + len('[HITL_BUTTONS:')
            marker_end = response.find(']', marker_start)
            draft_ids_str = response[marker_start:marker_end]
            draft_ids = draft_ids_str.split(',')
            
            # Remove the marker from response
            response = response[:response.find('[HITL_BUTTONS:')] + response[response.find(']', marker_start) + 1:]
            response = response.strip()
            
            # Create HITL buttons
            keyboard = [
                [
                    InlineKeyboardButton("✅ Confirm All", callback_data=f"hitl_confirm:{','.join(draft_ids)}"),
                    InlineKeyboardButton("❌ Cancel All", callback_data=f"hitl_cancel:{','.join(draft_ids)}")
                ]
            ]
            
            # Add edit buttons for each draft (up to 3 to avoid too many buttons)
            for i, draft_id in enumerate(draft_ids[:3], 1):
                keyboard.append([
                    InlineKeyboardButton(f"✏️ Edit Task {i}", callback_data=f"hitl_edit:{draft_id}:{i}")
                ])
            
            if len(draft_ids) > 3:
                keyboard.append([
                    InlineKeyboardButton("✏️ More Edit Options", callback_data=f"hitl_edit_more:{','.join(draft_ids[3:])}")
                ])
            
            reply_markup = InlineKeyboardMarkup(keyboard)

        # Send response
        escaped_response = escape_markdown_v2(response)
        logger.info(f'Bot response length: {len(response)} chars')

        await update.message.reply_text(escaped_response, parse_mode='MarkdownV2', reply_markup=reply_markup)

    except Exception as e:
        logger.error(f'Error in handle_message: {e}')
        # Fallback to plain text if MarkdownV2 fails
        try:
            await update.message.reply_text(response)
        except:
            await update.message.reply_text("I encountered an error processing your message. Please try again or use /help for assistance.")

# Error handler
async def error(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Enhanced error handler with logging."""
    logger.error(f"Update {update} caused error {context.error}")

    # Try to send error message to user if possible
    if update and update.effective_message:
        try:
            await update.effective_message.reply_text(
                "🚨 I encountered a technical issue. Please try again in a moment or contact support if the problem persists."
            )
        except Exception as e:
            logger.error(f"Failed to send error message to user: {e}")

async def start_scheduler(app: Application):
    """Start the APScheduler after the event loop is running."""
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        send_reminders,
        trigger=IntervalTrigger(seconds=60),  # Check every minute
        args=[app],  # Pass the Application instance
        id='send_reminders_job',
        name='Send task reminders to users',
        max_instances=1
    )
    scheduler.start()
    print("✅ Reminder scheduler started")

if __name__ == '__main__':
    print('Starting Enhanced Copilot Bot with Supabase integration...')
    app = Application.builder().token(TOKEN).build()

    # Set up post_init to start the scheduler
    app.post_init = start_scheduler

    # Commands
    app.add_handler(CommandHandler('start', start_command))
    app.add_handler(CommandHandler('help', help_command))
    app.add_handler(CommandHandler('settimezone', set_timezone_command))
    app.add_handler(CommandHandler('new_task', new_task_command))
    app.add_handler(CommandHandler('tasks', tasks_command))
    app.add_handler(CommandHandler('web3query', web3query_command))

    # Messages
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    # Callback handler for inline buttons
    app.add_handler(CallbackQueryHandler(button_callback))

    # Error handler
    app.add_error_handler(error)

    # Start polling
    print("🚀 Enhanced Copilot Bot is now running...")
    print("✅ Supabase integration active")
    print("✅ AI attribute generation enabled")
    print("✅ Smart clarification system ready")
    print("Polling for messages...")

    app.run_polling(poll_interval=3)