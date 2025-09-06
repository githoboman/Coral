from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CommandHandler, CallbackQueryHandler, ConversationHandler
import logging
from supabase import create_client
from datetime import datetime
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Supabase client
supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_KEY")
if not supabase_url or not supabase_key:
    raise ValueError("SUPABASE_URL and SUPABASE_KEY must be set in the environment or .env file")
supabase = create_client(supabase_url, supabase_key)

def escape_markdown_v2(text: str) -> str:
    if not text:
        return ""
    markdown_chars = ['_', '*', '[', ']', '(', ')', '~', '`', '#', '+', '-', '=', '|', '{', '}', '.', '!']
    escaped_text = text
    for char in markdown_chars:
        escaped_text = escaped_text.replace(char, f'\\{char}')
        logger.debug(f"Escaped MarkdownV2 text: '{escaped_text}'")
    return escaped_text

async def tasks_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = str(update.effective_user.id)
    try:
        response = supabase.table('tasks').select('*').eq('user_id', user_id).execute()
        tasks = response.data
        if not tasks:
            message = "*No tasks found.*"
        else:
            keyboard = []
            message = "*Your tasks:*\n"
            for task in tasks:
                task_str = f"- {task['task_name']} (ID: {task['id']})"
                if task['due_date']:
                    task_str += f" (Due: {datetime.fromisoformat(task['due_date']).strftime('%Y-%m-%d %H:%M')})"
                message += f"{task_str}\n"
                keyboard.append([
                    InlineKeyboardButton("✅ Complete", callback_data=f"complete_{task['id']}"),
                    InlineKeyboardButton("✏️ Edit", callback_data=f"edit_{task['id']}"),
                    InlineKeyboardButton("🗑️ Delete", callback_data=f"delete_{task['id']}"),
                    InlineKeyboardButton("🔍 Details", callback_data=f"details_{task['id']}")
                ])
            reply_markup = InlineKeyboardMarkup(keyboard) if keyboard else None
        escaped_message = escape_markdown_v2(message)
        await update.message.reply_text(escaped_message, parse_mode='MarkdownV2', reply_markup=reply_markup)
    except Exception as e:
        logger.error(f'Error in tasks_command: {e}')
        await update.message.reply_text(f"Sorry, I encountered an error: {str(e)}", parse_mode="MarkdownV2")

async def button_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    logger.info(f"🔧 button_callback triggered with data={query.data}, user={query.from_user.id}")
    action, task_id = query.data.split('_', 1)
    try:
        if action == "complete":
            supabase.table('tasks').update({'status': 'completed'}).eq('id', task_id).execute()
            await query.edit_message_text(f"*Task {task_id} marked as complete!*", parse_mode="MarkdownV2")
        # Add logic for edit, delete, details as needed
    except Exception as e:
        logger.error(f'❌ Error in button_callback: {str(e)}')
        await query.answer("Error processing your request. Please try again.")

# Export the conversation handler with a state
tasks_handler = ConversationHandler(
    entry_points=[CommandHandler('tasks', tasks_command)],
    states={
        'TASK_LIST': [CallbackQueryHandler(button_callback)]  # Handle callbacks in TASK_LIST state
    },
    fallbacks=[]  # Remove fallbacks to force state-based handling
)