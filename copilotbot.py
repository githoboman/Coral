#!/usr/bin/env python3
from parsedatetime import Calendar
from typing import Final
from web3 import Web3
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes, CallbackQueryHandler
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
import os
from dotenv import load_dotenv
import logging
from datetime import datetime
from ai.agent import CopilotAgent  # Import CopilotAgent from ai/agent.py
from supabase import create_client, Client

# Load environment variables from .env file
load_dotenv()

# Get the token and Gemini API key from environment variables
TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
INFURA_PROJECT_ID = os.getenv("INFURA_PROJECT_ID")

# Check if tokens are loaded
if not TOKEN:
    raise ValueError('TELEGRAM_BOT_TOKEN must be set')
if not GEMINI_API_KEY:
    raise ValueError('GEMINI_API_KEY must be set')

BOT_USERNAME: Final = '@myclosestbot'

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

# Custom handler to filter httpx logs
class TokenFilter(logging.Filter):
    def filter(self, record):
        if hasattr(record, 'msg'):
            original_msg = str(record.msg)
            if 'api.telegram.org/bot' in original_msg and TOKEN in original_msg:
                modified_msg = original_msg.replace(TOKEN, '[REDACTED]')
                record.msg = modified_msg
        return True

# Apply filter to httpx logger
httpx_logger = logging.getLogger('httpx')
httpx_logger.setLevel(logging.INFO)
httpx_logger.addFilter(TokenFilter())

# Initialize CopilotAgent
agent = CopilotAgent(GEMINI_API_KEY)
print("Bot starting with token and Gemini API key loaded")

# Supabase configuration

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError('SUPABASE_URL and SUPABASE_KEY must be set')
supabase: Client  = create_client(SUPABASE_URL, SUPABASE_KEY)

# Helper function to escape MarkdownV2 characters
def escape_markdown_v2(text: str) -> str:
    markdown_chars = ['_', '*', '[', ']', '(', ')', '~', '`', '#', '+', '-', '=', '|', '{', '}', '.', '!']
    escaped_text = text
    for char in markdown_chars:
        escaped_text = escaped_text.replace(char, f'\\{char}')
    return escaped_text

# Commands
async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    message = (
        "*Welcome to Copilot*\n"
        "I can help you manage tasks and explore Web3 data. Try these first steps:\n"
        "- Type */newt_task to create your first task!\n"
        "- Use */help* for more commands.\n"
    )
    logger.info(f"Sending MarkdownV2 message: {message}")
    try:
        escaped_message = escape_markdown_v2(message)
        await update.message.reply_text(escaped_message, parse_mode='MarkdownV2')
    except Exception as e:
        logger.error(f'Error in start_command: {e}')
        await update.message.reply_text(f"Sorry, I encountered an error: {str(e)}")

async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    message = (
        "*\\'/start\\': Welcome to Copilot*\n"
        "*\\'/help\\': I can help you with anything within my power*\n"
        "*\\'/new_task\\': Create your new tasks here*\n"
        "*\\'/tasks\\': Show all tasks here*\n"
        "*\\'/web3query\\': Search for web3 information here*\n"
        "*Examples*:\n"
        " - 'Remind me to buy ETH on Sunday'\n"
        " - 'List my tasks'\n"
        " - 'Complete task abcdef12'"
    )

    # async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    #     keyboard = [[InlineKeyboardButton('Test Button', url="https://example.com")]]
    #     reply_markup = InlineKeyboardMarkup(keyboard)
    #     try:
    #         await update.message.reply_text("Test", reply_markup=reply_markup)
    #     except Exception as e:
    #         logger.error(f'Error in help_command: {e}')
    #         await update.message.reply_text(f"Sorry, I encountered an error: {str(e)}")
    keyboard = [
        [InlineKeyboardButton('Contact Support', url="https://example.com/support")],
        [InlineKeyboardButton('Join Community', url="https://example.com/community")],
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    try:
        escaped_message = escape_markdown_v2(message)
        print(f"Sending message with reply_markup: {reply_markup}")
        await update.message.reply_text(escaped_message, parse_mode='MarkdownV2')
    except Exception as e:
        logger.error(f'Error in help_command: {e}')
        await update.message.reply_text(f"Sorry, I encountered an error: {str(e)}")

async def new_task_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        args = context.args
        if not args:
            message = "*Okay, what's your task?*\n*You can tell me something like 'Remind me to research AI trends next Tuesday by 3 PM'*"
            logger.info(f"Sending MarkdownV2 message: {message}")
            escaped_message = escape_markdown_v2(message)
            await update.message.reply_text(escaped_message, parse_mode="MarkdownV2")
            return
        task_input = " ".join(args)
        user_id = str(update.effective_user.id)
        cal = Calendar()
        time_struct, parse_status = cal.parse(task_input)
        due_date = datetime(*time_struct[:6]) if parse_status else None
        task_name = task_input
        if due_date:
            task_name = " ".join(word for word in args if word.lower() not in ["at", "on", "by"]) #Crude extraction
        data = supabase.table('tasks').insert({
            'user_id': user_id,
            'task_name': task_name.strip(),
            'created_at': datetime.now().isoformat(),
            'due_date': due_date.isoformat() if due_date else None
        }).execute()
        task_id = data.data[0]['id'] if data.data else 'UNKNOWN'
        message = f"Task '{task_name}' created with ID: {task_id}"
        escaped_message = escape_markdown_v2(message)
        await update.message.reply_text(escaped_message, parse_mode="MarkdownV2")
        logger.info(f"Task '{task_name}' created for user: {user_id}")
    except Exception as e:
        logger.error(f'Error in new_task_command: {e}')
        await update.message.reply_text(f"Sorry, I encountered an error: {str(e)}")

async def tasks_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = str(update.effective_user.id)
    try:
        # Fetch from Supabase
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
        await update.message.reply_text(f"Sorry, I encountered an error: {str(e)}")

async def button_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    action, task_id = query.data.split('_',1)
    if action == "complete":
        await query.edit_message_text(f"Task {task_id} marked as complete!")
    # Add logic for edit, delete, details

async def web3query_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        args = context.args
        if not args:
            message = "*What Web3 information are you looking for? Try something like 'ETH balance of 0x123...ABC' or 'Current price of SOL'.*"
            escaped_message = escape_markdown_v2(message)
            await update.message.reply_text(escaped_message, parse_mode='MarkdownV2')
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
            message = "*Unsupported query. Try 'ETH balance of 0x123...ABC' or 'Current price of SOL'.*"
        escaped_message = escape_markdown_v2(message)
        await update.message.reply_text(escaped_message, parse_mode='MarkdownV2')
    except Exception as e:
        logger.error(f'Error in web3query_command: {e}')
        await update.message.reply_text(f"Sorry, I encountered an error: {str(e)}")

# Message handler using CopilotAgent
async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    message_type: str = update.message.chat.type
    text: str = update.message.text.lower()
    user_id = str(update.effective_user.id)

    logger.info(f"User ({user_id}) in {message_type}: '{text}'")

    # Handle group messages with bot mention
    if message_type == 'group':
        if BOT_USERNAME in text:
            new_text: str = text.replace(BOT_USERNAME, "").strip()
        else:
            return
    else:
        new_text = text

    try:
        if "create a task" in new_text:
            task_details = new_text.replace("create a task", "").strip()
            context.args = task_details.split()
            await new_task_command(update, context)
            return
        elif "remind me to" in new_text and ("at" in new_text or "on" in new_text):
            task_details = new_text.replace("remind me to", "").strip()
            context.args = task_details.split()
            await new_task_command(update, context)
            return
        # Process message using CopilotAgent
        response = await agent.process_message(user_id, new_text)
        escaped_response = escape_markdown_v2(response)
        logger.info(f'Bot response: {response}')
        await update.message.reply_text(escaped_response, parse_mode='MarkdownV2')
    except Exception as e:
        logger.error(f'Error in handle_message: {e}')
        await update.message.reply_text(f"Sorry, I encountered an error: {str(e)}")

# Error handler
async def error(update: Update, context: ContextTypes.DEFAULT_TYPE):
    logger.error(f"Update {update} caused error {context.error}")

if __name__ == '__main__':
    print('Starting bot...')
    app = Application.builder().token(TOKEN).build()
    print(f"App type: {type(app)}")

    # Commands
    app.add_handler(CommandHandler('start', start_command))
    app.add_handler(CommandHandler('help', help_command))
    app.add_handler(CommandHandler('new_task', new_task_command))
    app.add_handler(CommandHandler('tasks', tasks_command))
    app.add_handler(CommandHandler('web3query', web3query_command))

    # Messages
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    # Callback handler
    app.add_handler(CallbackQueryHandler(button_callback))

    # Errors
    app.add_error_handler(error)

    # Poll the bot
    print("Polling...")
    app.run_polling(poll_interval=3)