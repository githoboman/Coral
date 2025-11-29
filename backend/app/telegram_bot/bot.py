# app/telegram_bot/bot.py
"""
Telegram bot setup and configuration module
This module contains the setup function to initialize all bot handlers
"""
import logging
from telegram import Update
from telegram.ext import (
    Application, CommandHandler, MessageHandler,
    CallbackQueryHandler, ConversationHandler, filters
)

# Import all the handlers from your bot file
from app.telegram_bot.handlers.signup import signup_handler
from app.telegram_bot.handlers.commands import (
    help_command, security_command, admin_generate_codes,
    admin_check_code, complete_task_command, my_tasks_command,
    timezone_command, debug_tasks_command, force_timezone_command
)
from app.telegram_bot.handlers.checkin import (
    checkin_handler, checkin_status_handler, check_my_profile_handler
)
from app.telegram_bot.handlers.leaderboard import (
    leaderboard_handler, refresh_leaderboard_button_handler
)
from app.telegram_bot.handlers.tasks import (
    task_conv_handler, setup_callback_handler
)
from app.telegram_bot.handlers.portfolio import portfolio_handler
from app.telegram_bot.handlers.errors import error_handler

logger = logging.getLogger(__name__)


def setup_telegram_bot(token: str) -> Application:
    """
    Initialize and configure the Telegram bot with all handlers
    
    Args:
        token: Telegram bot token from BotFather
        
    Returns:
        Configured Application instance
    """
    # Build the application
    application = Application.builder().token(token).build()

    # Add command handlers
    application.add_handler(CommandHandler("help", help_command))
    application.add_handler(CommandHandler("security", security_command))
    application.add_handler(CommandHandler(
        "generate_codes", admin_generate_codes))
    application.add_handler(CommandHandler("check_code", admin_check_code))
    application.add_handler(CommandHandler(
        "complete_task", complete_task_command))
    application.add_handler(CommandHandler("my_tasks", my_tasks_command))
    application.add_handler(CommandHandler("timezone", timezone_command))
    application.add_handler(CommandHandler("debug_task", debug_tasks_command))
    application.add_handler(CommandHandler(
        "reset_timezone", force_timezone_command))

    # Add conversation handlers (these must come before simple command handlers)
    application.add_handler(signup_handler)
    application.add_handler(task_conv_handler)

    # Add callback query handlers
    application.add_handler(setup_callback_handler)
    application.add_handler(refresh_leaderboard_button_handler)

    # Add feature handlers
    application.add_handler(checkin_handler)
    application.add_handler(checkin_status_handler)
    application.add_handler(check_my_profile_handler)
    application.add_handler(leaderboard_handler)
    application.add_handler(portfolio_handler)

    # Add error handler
    application.add_error_handler(error_handler)

    logger.info("Telegram bot handlers registered")

    return application
