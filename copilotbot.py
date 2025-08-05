from typing import Final
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes
import os
from dotenv import load_dotenv
import logging
from datetime import datetime
from ai.agent import CopilotAgent  # Import CopilotAgent from ai/agent.py

# Load environment variables from .env file
load_dotenv()

# Get the token and Gemini API key from environment variables
TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

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
    try:
        escaped_message = escape_markdown_v2(message)
        await update.message.reply_text(escaped_message, parse_mode='MarkdownV2')
    except Exception as e:
        logger.error(f'Error in help_command: {e}')
        await update.message.reply_text(f"Sorry, I encountered an error: {str(e)}")

async def new_task_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    message = "*Okay, what's your task?*\n*You can tell me something like 'Remind me to research AI trends next Tuesday by 3 PM'*"
    logger.info(f"Sending MarkdownV2 message: {message}")
    try:
        escaped_message = escape_markdown_v2(message)
        await update.message.reply_text(escaped_message, parse_mode="MarkdownV2")
    except Exception as e:
        logger.error(f'Error in new_task_command: {e}')
        await update.message.reply_text(f"Sorry, I encountered an error: {str(e)}")

async def tasks_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = str(update.effective_user.id)
    try:
        response = await agent.process_message(user_id, "list my tasks")
        escaped_response = escape_markdown_v2(response)
        await update.message.reply_text(escaped_response, parse_mode='MarkdownV2')
    except Exception as e:
        logger.error(f'Error in tasks_command: {e}')
        await update.message.reply_text(f"Sorry, I encountered an error: {str(e)}")

async def web3query_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("This is web3query (not implemented yet)")

# Message handler using CopilotAgent
async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    message_type: str = update.message.chat.type
    text: str = update.message.text
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

    # Commands
    app.add_handler(CommandHandler('start', start_command))
    app.add_handler(CommandHandler('help', help_command))
    app.add_handler(CommandHandler('new_task', new_task_command))
    app.add_handler(CommandHandler('tasks', tasks_command))
    app.add_handler(CommandHandler('web3query', web3query_command))

    # Messages
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    # Errors
    app.add_error_handler(error)

    # Poll the bot
    print("Polling...")
    app.run_polling(poll_interval=3)