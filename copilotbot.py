# copilotbot.py
from typing import Final
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes
import os
from dotenv import load_dotenv
import logging

# Load environment variables
load_dotenv()
TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
if not TOKEN:
    raise ValueError('TOKEN must be set')

BOT_USERNAME: Final = '@myclosestbot'

# Configure logging
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
                record.msg = original_msg.replace(TOKEN, '[REDACTED]')
        return True

# Apply filter to httpx logger
httpx_logger = logging.getLogger('httpx')
httpx_logger.setLevel(logging.INFO)
httpx_logger.addFilter(TokenFilter())

# Commands
async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    print(f"Start command received from {update.message.chat.id}")
    message = (
        "Welcome to Copilot\n"
        "Overview:\n"
        "Copilot is an AI\\-powered assistant that helps you with your web3 journey\\. It can fetch data about any cryptocurrency \\(e\\.g\\. \\- Bitcoin\\)\\.\n"
        "Use '/help' to explore more\\!"
    )
    logger.info(f"Sending MarkdownV2 message: {message}")
    try:
        await update.message.reply_text(message, parse_mode='MarkdownV2')
    except Exception as e:
        logger.error(f'Error in start_command: {e}')
        await update.message.reply_text("An error occurred. Please try again or use /help for assistance.")

async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    message = (
        "'/start': Welcome to Copilot\n"
        "'/help': I can help you with anything within my power\n"
        "'/new\\-task': Create your new tasks here\n"
        "'/tasks': Show all tasks here\n"
        "'/web3query': Search for web3 information here"
    )
    logger.info(f"Sending MarkdownV2 message: {message}")
    try:
        await update.message.reply_text(message, parse_mode='MarkdownV2')
    except Exception as e:
        logger.error(f'Error in help_command: {e}')
        await update.message.reply_text("An error occurred. Please try again.")

async def new_task_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    message = (
        "Okay what's your task\\?\n"
        "You can tell me something like 'Remind me to research AI trends next Tuesday by 3 PM'"
    )
    logger.info(f"Sending MarkdownV2 message: {message}")
    try:
        await update.message.reply_text(message, parse_mode='MarkdownV2')
    except Exception as e:
        logger.error(f'Error in new_task_command: {e}')
        await update.message.reply_text("An error occurred. Please try again.")

async def tasks_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        await update.message.reply_text("This is tasks", parse_mode='MarkdownV2')
    except Exception as e:
        logger.error(f'Error in tasks_command: {e}')
        await update.message.reply_text("An error occurred. Please try again.")

async def web3query_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        await update.message.reply_text("This is web3query", parse_mode='MarkdownV2')
    except Exception as e:
        logger.error(f'Error in web3query_command: {e}')
        await update.message.reply_text("An error occurred. Please try again.")

# Responses
def handle_response(text: str) -> str:
    processed: str = text.lower()
    if 'hello' in processed:
        return "Hey there!"
    if 'how are you' in processed:
        return "I'm fine, thank you!"
    if 'i love copilot' in processed:
        return "I'm glad you do, thank you!"
    return 'I do not understand what you wrote'

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    message_type: str = update.message.chat.type
    text: str = update.message.text

    logger.info(f"User ({update.message.chat.id}) in {message_type}: '{text}'")

    if message_type == 'group':
        if BOT_USERNAME in text:
            new_text: str = text.replace(BOT_USERNAME, "").strip()
            response: str = handle_response(new_text)
        else:
            return
    else:
        response: str = handle_response(text)

    logger.info(f'Bot response: {response}')
    try:
        await update.message.reply_text(response, parse_mode='MarkdownV2')
    except Exception as e:
        logger.error(f'Error in handle_message: {e}')
        await update.message.reply_text("An error occurred. Please try again.")

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

    # Polls the bot
    print("Polling...")
    app.run_polling(poll_interval=5)