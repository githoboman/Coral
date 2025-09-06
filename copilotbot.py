#!/usr/bin/env python3
from telegram.ext import Application, CommandHandler, CallbackQueryHandler, ContextTypes, ConversationHandler, MessageHandler, filters
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, ReplyKeyboardMarkup
import logging
import os
from dotenv import load_dotenv
from supabase import create_client, Client
import smtplib
from email.mime.text import MIMEText
from parsedatetime import Calendar
from datetime import datetime
from task_manager import task_conv_handler
from tasks import tasks_handler
from web3 import Web3
from ai.agent import CopilotAgent
from apscheduler.schedulers.asyncio import AsyncIOScheduler

# Load environment variables
load_dotenv()

TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
INFURA_PROJECT_ID = os.getenv("INFURA_PROJECT_ID")

TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
if not TOKEN:
    raise ValueError('TELEGRAM_BOT_TOKEN must be set')

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError('SUPABASE_URL and SUPABASE_KEY must be set')

logging.getLogger("supabase").setLevel(logging.DEBUG)

EMAIL_USER = os.getenv("EMAIL_USER")
EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD")
if not EMAIL_USER or not EMAIL_PASSWORD:
    raise ValueError('EMAIL_USER and EMAIL_PASSWORD must be set')

# Conversation states (for delete command)
DELETE_TASK, DELETE_SELECT = range(2)

log_dir = 'logs'
os.makedirs(log_dir, exist_ok=True)
log_file = os.path.join(log_dir, 'copilot.log')
if not os.access(log_file, os.W_OK):
    raise PermissionError(f"Log file {log_file} is not writable. Check permissions.")
logging.basicConfig(
    level=logging.DEBUG,  # Keep application-level DEBUG
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.FileHandler(log_file), logging.StreamHandler()]
)
logger = logging.getLogger(__name__)

for logger_name in ['httpcore', 'httpcore.http11', 'httpcore.connection', 'telegram.ext', 'apscheduler']:
    logging.getLogger(logger_name).setLevel(logging.INFO)

# Initialize Supabase client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Initialize scheduler
scheduler = AsyncIOScheduler()

def escape_markdown_v2(text: str) -> str:
    if not text:
        return ""
    markdown_chars = ['_', '*', '[', ']', '(', ')', '~', '`', '#', '+', '-', '=', '|', '{', '}', '.', '!']
    escaped_text = text
    for char in markdown_chars:
        escaped_text = escaped_text.replace(char, f'\\{char}')
        logger.debug(f"Escaped MarkdownV2 text: '{escaped_text}'")
    return escaped_text

async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    message = "Welcome to Copilot!\nI can help you manage tasks and explore Web3 data. Try these first steps:\n- Type /new_task to create your first task!\n- Use /help for more commands.\nNote: Enable notification in chat settings for task alerts"
    logger.info(f"Sending message: {message}")
    try:
        await update.message.reply_text(message)
    except Exception as e:
        logger.error(f'Error in start_command: {e}')
        await update.message.reply_text(f"Sorry, I encountered an error: {str(e)}")

async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    message = "Commands:\n- /start: Welcome to Copilot\n- /help: I can help you with anything within my power\n- /new_task: Create your new tasks here\n- /tasks: Show all tasks here\n- /web3query: Search for web3 information here\nExamples:\n- 'Remind me to buy ETH on Sunday'\n- 'List my tasks'\n- 'Complete task abcdef12'"
    keyboard = [[InlineKeyboardButton('Contact Support', url="https://example.com/support")], [InlineKeyboardButton('Join Community', url="https://example.com/community")]]
    reply_markup = InlineKeyboardMarkup(keyboard)
    try:
        logger.info(f"Sending message with reply_markup: {reply_markup}")
        await update.message.reply_text(message, reply_markup=reply_markup)
    except Exception as e:
        logger.error(f'Error in help_command: {e}')
        await update.message.reply_text(f"Sorry, I encountered an error: {str(e)}")

async def web3query_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        args = context.args
        if not args:
            message = "What Web3 information are you looking for? Try something like 'ETH balance of 0x123...ABC' or 'Current price of SOL'."
            await update.message.reply_text(message)
            return
        query = " ".join(args).lower()
        w3 = Web3(Web3.HTTPProvider(f'https://mainnet.infura.io/v3/{INFURA_PROJECT_ID}'))
        if "eth balance" in query and "0x" in query:
            address = query.split("0x")[1].split()[0]
            balance = w3.eth.get_balance(Web3.to_checksum_address(f"0x{address}"))
            message = f"ETH balance for 0x{address}: {Web3.from_wei(balance, 'ether')} ETH"
        elif "price of" in query:
            message = f"Price of {query.split('of ')[1]}: [API not integrated yet]"
        else:
            message = "Unsupported query. Try 'ETH balance of 0x123...ABC' or 'Current price of SOL'."
        await update.message.reply_text(message)
    except Exception as e:
        logger.error(f'Error in web3query_command: {e}')
        await update.message.reply_text(f"Sorry, I encountered an error: {str(e)}")

async def del_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    logger.info(f"Received /del command, user={update.effective_user.id}")
    user_id = str(update.effective_user.id)
    try:
        logger.info("Fetching tasks for deletion prompt")
        response = supabase.table('tasks').select('*').eq('user_id', user_id).execute()
        tasks = response.data
        if not tasks:
            logger.warning(f"No tasks found for user {user_id}")
            await update.message.reply_text("You have no tasks to delete. Use /new_task to create one!")
            return ConversationHandler.END
        task_list = "Select tasks to delete by entering their IDs, either separated by commas (e.g., 56, 34, 34) or without commas (e.g., 563434). Available tasks:\n"
        for task in tasks:
            due_date = task.get('due_date')
            due_date_str = f"(Due: {datetime.fromisoformat(due_date).strftime('%Y-%m-%d %H:%M')})" if due_date else ""
            task_list += f"ID: {task['id']}. {task['task_name']} {due_date_str}\n"
        await update.message.reply_text(task_list)
        context.user_data['tasks'] = tasks  # Store tasks for reference
        return DELETE_SELECT
    except Exception as e:
        logger.error(f"Supabase error in del_command: {str(e)}", exc_info=True)
        await update.message.reply_text(f"Error loading tasks: {str(e)}. Please try again.")
        return ConversationHandler.END

async def handle_delete_select(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = str(update.effective_user.id)
    input_ids = update.message.text.strip()
    logger.info(f"Received task IDs to delete: {input_ids}, user={update.effective_user.id}")
    try:
        logger.info("Starting deletion process")
        import re
        task_ids = [match.group() for match in re.finditer(r'\d+', input_ids)]
        if not task_ids:
            logger.warning(f"Invalid task IDs format: {input_ids}")
            await update.message.reply_text("Please enter valid task IDs (e.g., 56, 34, 34 or 563434). Use /del to see available IDs.")
            return DELETE_SELECT
        deleted_ids = []
        failed_ids = []
        for task_id_str in task_ids:
            task_id = int(task_id_str)
            logger.info(f"Processing task ID: {task_id}")
            logger.info("Executing select query to verify task")
            select_response = supabase.table('tasks').select('id', 'task_name').eq('user_id', user_id).eq('id', task_id).execute()
            logger.info(f"Select response: {select_response}")
            if not select_response.data:
                logger.warning(f"No task found with ID {task_id} for user {user_id}")
                failed_ids.append(task_id_str)
                continue
            logger.info("Executing delete query")
            delete_response = supabase.table('tasks').delete().eq('id', task_id).eq('user_id', user_id).execute()
            logger.info(f"Delete response: {delete_response}")
            if (hasattr(delete_response, 'status_code') and delete_response.status_code in (200, 204)) or \
                    (delete_response.data and len(delete_response.data) > 0):
                logger.info(f"Task {task_id} deleted for user {user_id}")
                deleted_ids.append(task_id_str)
            else:
                logger.warning(f"Delete operation for task {task_id} failed: {delete_response}")
                failed_ids.append(task_id_str)
        if deleted_ids:
            deleted_list = ', '.join([f'{id}' for id in deleted_ids])
            await update.message.reply_text(f"Tasks deleted: {deleted_list}")
        if failed_ids:
            failed_list = ', '.join([f'{id}' for id in failed_ids])
            await update.message.reply_text(f"Failed to delete tasks: {failed_list}. They may not exist or an error occurred.")
    except Exception as e:
        logger.error(f"Error in handle_delete_select: {str(e)}", exc_info=True)
        await update.message.reply_text(f"Error deleting tasks: {str(e)}. Please try again.")
    context.user_data.clear()
    return ConversationHandler.END

async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    logger.info(f"Cancel command received, user={update.effective_user.id}")
    await update.message.reply_text("Cancelled.")
    context.user_data.clear()
    return ConversationHandler.END

if __name__ == '__main__':
    print(f"Loaded TOKEN: {os.getenv('TELEGRAM_BOT_TOKEN')}")
    app = Application.builder().token(TOKEN).build()

    # Add handlers
    app.add_handler(task_conv_handler)
    app.job_queue.scheduler = scheduler #Make scheduler avaible in context
    app.add_handler(ConversationHandler(
        entry_points=[CommandHandler('del', del_command)],
        states={
            DELETE_SELECT: [MessageHandler(filters.TEXT & ~filters.COMMAND, handle_delete_select)],
        },
        fallbacks=[CommandHandler('cancel', cancel)]
    ))
    app.add_handler(CommandHandler('start', start_command))
    app.add_handler(CommandHandler('help', help_command))
    app.add_handler(CommandHandler('web3query', web3query_command))
    app.add_handler(tasks_handler)

    # Global error handler
    def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
        logger.error("Exception while handling an update:", exc_info=context.error)

    app.add_error_handler(error_handler)

    print("Polling...")
    app.run_polling(allowed_updates=Update.ALL_TYPES)
