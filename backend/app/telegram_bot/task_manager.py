from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CommandHandler, MessageHandler, CallbackQueryHandler, ConversationHandler, \
    filters
from datetime import datetime, timedelta
import logging
import pytz
from parsedatetime import Calendar
import re
from typing import Dict, Optional

# Import your encryption utilities
from app.telegram_bot.utils import (
    get_walrus_client, get_key_manager, get_sui_client,
    is_valid_email,
    ensure_user_has_keys, get_user_private_key,
    load_user_session, save_user_session, save_user_timezone, load_user_timezone
)

logger = logging.getLogger(__name__)

# Initialize encrypted storage clients
walrus = get_walrus_client()
key_manager = get_key_manager()
sui = get_sui_client()

# Conversation states
TASK_DESCRIPTION, TASK_REVIEW, EMAIL_SETUP, PAYMENT_CONFIRM, SELECT_TASK = range(
    5)

# Pricing configuration
EMAIL_NOTIFICATION_PRICE = 0.01  # SUI per email
PREMIUM_MONTHLY = 5.00  # SUI per month


class TaskManager:
    """Modern task management with payment features"""

    @staticmethod
    async def send_message(update: Update, text: str, reply_markup=None):
        """Universal method to send messages for both Message and CallbackQuery updates"""
        try:
            if hasattr(update, 'message') and update.message:
                # This is a Message update
                return await update.message.reply_text(text, reply_markup=reply_markup)
            elif hasattr(update, 'callback_query') and update.callback_query:
                # This is a CallbackQuery update
                if update.callback_query.message:
                    return await update.callback_query.message.reply_text(text, reply_markup=reply_markup)
                else:
                    # Fallback: use bot to send message
                    bot = update.callback_query.bot
                    chat_id = update.callback_query.from_user.id
                    return await bot.send_message(chat_id=chat_id, text=text, reply_markup=reply_markup)
            else:
                # Fallback for any other case
                logger.error("Could not determine how to send message")
                return None
        except Exception as e:
            logger.error(f"Error sending message: {e}")
            return None

    @staticmethod
    async def edit_message(update: Update, text: str, reply_markup=None):
        """Universal method to edit messages for CallbackQuery updates"""
        try:
            if hasattr(update, 'callback_query') and update.callback_query:
                return await update.callback_query.edit_message_text(text, reply_markup=reply_markup)
            else:
                # If it's not a callback query, send a new message instead
                return await TaskManager.send_message(update, text, reply_markup)
        except Exception as e:
            logger.error(f"Error editing message: {e}")
            return None

    @staticmethod
    async def create_modern_task_ui(update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Create beautiful task creation interface with one-time timezone setup"""
        telegram_id = str(update.effective_user.id)

        # Check if user has a valid session
        session = await load_user_session(telegram_id, context)
        if not session or not session.get('profile_id'):
            return await TaskManager.show_setup_guide(update, context)

        # Verify encryption setup
        has_keys = await ensure_user_has_keys(telegram_id, context)
        if not has_keys:
            return await TaskManager.show_encryption_setup(update, context)

        # Load user's default timezone
        user_timezone = await load_user_timezone(telegram_id, context)

        # Check if user has NO timezone set (first-time user)
        if not user_timezone or user_timezone == 'UTC':
            # First-time user needs timezone setup
            return await TaskManager.show_timezone_selection(update, context)

        # User has timezone set - proceed directly to task input
        context.user_data['user_timezone'] = user_timezone

        await TaskManager.send_message(
            update,
            f"🎯 Create New Encrypted Task\n\n"
            f"🌍 Your timezone: {user_timezone}\n"
            f"💡 Need to change timezone? Use /timezone\n\n"
            "✨ How it works:\n"
            "• Describe your task naturally\n"
            "• We'll detect dates automatically\n"
            "• Everything is encrypted for privacy\n\n"
            "📝 Examples:\n"
            "• \"Buy groceries tomorrow at 3pm\"\n"
            "• \"Call John on Friday 2pm\"\n"
            "• \"Finish report by next Monday\"\n"
            "• \"Remind me in 5 minutes\"\n"
            "• \"Alert me in 1 hour\"\n\n"
            "✨ Simply tell me what you need to do..."
        )
        return TASK_DESCRIPTION

    @staticmethod
    async def show_setup_guide(update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Show interactive setup guide for new users"""
        setup_guide = (
            "👋 Welcome to Encrypted Tasks! 🔐\n\n"
            "It looks like you're new here. Let's get you set up quickly:\n\n"
            "🚀 Quick Setup Process:\n"
            "1. Use /start - Create your profile\n"
            "2. Use /start - Secure your data\n"
            "3. Start creating encrypted tasks!\n\n"
            "✨ What you'll get:\n"
            "• End-to-end encrypted task storage\n"
            "• Secure blockchain-backed tasks\n"
            "• Smart reminders and notifications\n"
            # "• Pay-per-email or premium options\n\n"
            "Ready to begin?"
        )

        keyboard = [
            [InlineKeyboardButton(
                "🚀 Use /start", callback_data="guide_start")],
            # [InlineKeyboardButton("🔐 Use /start", callback_data="guide_start")],
            [InlineKeyboardButton("📚 Learn Features",
                                  callback_data="learn_features")],
            [InlineKeyboardButton(
                "❌ Maybe Later", callback_data="cancel_setup")]
        ]

        await TaskManager.send_message(
            update,
            setup_guide,
            reply_markup=InlineKeyboardMarkup(keyboard)
        )
        return ConversationHandler.END

    @staticmethod
    async def show_encryption_setup(update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Show encryption setup guide"""
        encryption_guide = (
            "🔐 Encryption Setup Required\n\n"
            "To protect your tasks with military-grade encryption:\n\n"
            "✨ Why encryption matters:\n"
            "• Your tasks are encrypted before storage\n"
            "• Only you can read your task details\n"
            "• Zero-knowledge privacy protection\n"
            "• Blockchain-backed security\n\n"
            "🚀 Simple setup:\n"
            "Just use /start to create your encryption keys\n\n"
            "This takes less than 30 seconds!"
        )

        keyboard = [
            [InlineKeyboardButton(
                "🔐 Use /start", callback_data="guide_setup_password")],
            [InlineKeyboardButton("📖 How Encryption Works",
                                  callback_data="learn_encryption")],
            [InlineKeyboardButton(
                "❌ Skip for Now", callback_data="cancel_setup")]
        ]

        await TaskManager.send_message(
            update,
            encryption_guide,
            reply_markup=InlineKeyboardMarkup(keyboard)
        )
        return ConversationHandler.END

    @staticmethod
    async def handle_setup_callbacks(update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle all setup-related callback queries"""
        query = update.callback_query
        await query.answer()

        action = query.data

        if action == "guide_start":
            await TaskManager.edit_message(
                update,
                "🚀 Perfect! Let's begin your setup:\n\n"
                "Please type the following command:\n\n"
                "💻 `/start`\n\n"
                "This will:\n"
                "• Create your blockchain identity\n"
                "• Initialize your secure profile\n"
                "• Generate your referral code\n"
                "• Prepare for encrypted task creation\n\n"
                "✨ Simply type: `/start`\n\n"
                "I'll be waiting for your command! 🎯"
            )

        elif action == "guide_setup_password":
            await TaskManager.edit_message(
                update,
                "🔐 Excellent! Let's secure your data:\n\n"
                "Please type the following command:\n\n"
                "💻 `/start`\n\n"
                "This will:\n"
                "• Generate your personal encryption keys\n"
                "• Encrypt your private key with a password\n"
                "• Enable end-to-end encrypted storage\n"
                "• Protect all your future tasks\n\n"
                "✨ Simply type: `/start`\n\n"
                "Your privacy and security are our top priority! 🔒"
            )

        elif action == "learn_features":
            await TaskManager.edit_message(
                update,
                "✨ Encrypted Task Manager - Feature Overview\n\n"
                "🔐 SECURITY FEATURES:\n"
                "• RSA-4096 + AES-256-GCM encryption\n"
                "• Zero-knowledge architecture\n"
                "• Only you can decrypt your data\n"
                "• Blockchain-backed verification\n\n"
                "🎯 TASK MANAGEMENT:\n"
                "• Natural language processing\n"
                "• Smart date detection\n"
                "• Encrypted reminders\n"
                "• Cross-device sync\n\n"
                "💰 FLEXIBLE PRICING:\n"
                f"• Pay-per-email: {EMAIL_NOTIFICATION_PRICE} SUI\n"
                f"• Premium unlimited: {PREMIUM_MONTHLY} SUI/month\n"
                "• No hidden fees\n\n"
                "Ready to get started? Use the commands below:",
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton(
                        "🚀 Use /start", callback_data="guide_start")],
                    [InlineKeyboardButton(
                        "🔐 Use /setup_password", callback_data="guide_setup_password")]
                ])
            )

        elif action == "learn_encryption":
            await TaskManager.edit_message(
                update,
                "🔐 How End-to-End Encryption Works\n\n"
                "✨ YOUR SECURITY:\n"
                "1. We generate RSA-4096 key pair for you\n"
                "2. Your private key is encrypted with your password\n"
                "3. Tasks are encrypted with AES-256-GCM\n"
                "4. Only you can decrypt with your private key\n\n"
                "🔒 WHAT WE CAN'T SEE:\n"
                "• Your task descriptions\n"
                "• Your due dates\n"
                "• Your personal notes\n"
                "• Any sensitive information\n\n"
                "💾 SECURE STORAGE:\n"
                "• Encrypted data on Walrus network\n"
                "• Blockchain references on Sui\n"
                "• Your keys stay with you\n\n"
                "Ready to secure your data?",
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton(
                        "🔐 Use /setup_password", callback_data="guide_setup_password")]
                ])
            )

        elif action == "cancel_setup":
            await TaskManager.edit_message(
                update,
                "👋 No problem!\n\n"
                "Whenever you're ready to start creating encrypted tasks, just use:\n\n"
                "• `/start` - Begin setup\n"
                "• `/setup_password` - Secure your data\n\n"
                "Your encrypted task manager will be waiting! ✨\n\n"
                "Have questions? Feel free to ask!"
            )

    @staticmethod
    def detect_time_format_issues(text: str) -> Optional[str]:
        """Detect common time format issues and provide guidance"""
        issues = []

        # Check for space after colon
        if re.search(r'\d:\s+\d', text):
            issues.append(
                "❌ Space after colon (e.g., '4: 01pm')\n   ✅ Use: '4:01pm'")

        # Check for semicolon instead of colon
        if re.search(r'\d;\d', text):
            issues.append(
                "❌ Semicolon instead of colon (e.g., '3;30')\n   ✅ Use: '3:30'")

        # Check for missing zeros in minutes
        if re.search(r':\d(?:am|pm|$)(?!\d)', text):
            issues.append(
                "❌ Single digit minutes (e.g., '4:5pm')\n   ✅ Use: '4:05pm'")

        # Check for time without space before day
        if re.search(r'\d(?:am|pm)[a-zA-Z]', text):
            issues.append(
                "❌ Time attached to day (e.g., '2pmtomorrow')\n   ✅ Use: '2pm tomorrow'")

        # Check for date with slashes
        if re.search(r'\d+/\d+', text):
            issues.append(
                "❌ Date with slashes (e.g., '25/12')\n   ✅ Use: 'december 25'")

        # Check for time before day
        if re.search(r'\d(?:am|pm)\s+(tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)', text,
                     re.IGNORECASE):
            issues.append(
                "❌ Time before day (e.g., '2pm tomorrow')\n   ✅ Use: 'tomorrow 2pm'")

        if issues:
            return "\n\n".join(issues)
        return None

    @staticmethod
    def smart_date_parse(text: str, timezone: pytz.timezone) -> Dict:
        """Smart date parsing with timezone support and error handling"""
        cal = Calendar()
        time_struct, parse_status = cal.parse(text)

        result = {
            'original_text': text,
            'status': 'success' if parse_status else 'error',
            'due_date': None,
            'task_name': text,
            'error': None
        }

        if parse_status:
            try:
                # Create naive datetime
                due_date_naive = datetime(*time_struct[:6])

                # Check if the parsed date is in the past (naive comparison)
                now_naive = datetime.now()
                if due_date_naive < now_naive:
                    # If it's a past date, assume it's for next occurrence
                    if due_date_naive.date() == now_naive.date() and due_date_naive.time() < now_naive.time():
                        # Same day but earlier time, assume next day
                        due_date_naive += timedelta(days=1)
                    elif due_date_naive.date() < now_naive.date():
                        # Past date, assume next year or appropriate future
                        due_date_naive = due_date_naive.replace(
                            year=now_naive.year)
                        if due_date_naive < now_naive:
                            due_date_naive = due_date_naive.replace(
                                year=now_naive.year + 1)

                # Localize to user's timezone
                due_date = timezone.localize(due_date_naive)

                # Convert to UTC for storage
                due_date_utc = due_date.astimezone(pytz.UTC)

                result['due_date'] = due_date_utc
                result['task_name'] = TaskManager.clean_task_description(text)

            except Exception as e:
                result['status'] = 'error'
                result['error'] = f"Date conversion error: {str(e)}"
        else:
            result['error'] = "Could not parse any date from your input."

        return result

    @staticmethod
    def parse_relative_time(text: str, timezone: pytz.timezone) -> Optional[datetime]:
        """Parse relative time expressions like 'in 5 minutes', 'in 1 hour'"""
        text_lower = text.lower()

        # Patterns for relative time
        patterns = [
            (r'in\s+(\d+)\s*min(?:ute)?s?', 'minutes'),
            (r'in\s+(\d+)\s*hr?s?', 'hours'),
            (r'in\s+(\d+)\s*day?s?', 'days'),
            (r'in\s+(\d+)\s*week?s?', 'weeks'),
            (r'after\s+(\d+)\s*min(?:ute)?s?', 'minutes'),
            (r'after\s+(\d+)\s*hr?s?', 'hours'),
            (r'after\s+(\d+)\s*day?s?', 'days'),
            (r'after\s+(\d+)\s*week?s?', 'weeks'),
            (r'(\d+)\s*min(?:ute)?s?\s+from\s+now', 'minutes'),
            (r'(\d+)\s*hr?s?\s+from\s+now', 'hours'),
            (r'(\d+)\s*day?s?\s+from\s+now', 'days'),
            (r'(\d+)\s*week?s?\s+from\s+now', 'weeks'),
        ]

        for pattern, unit in patterns:
            match = re.search(pattern, text_lower)
            if match:
                try:
                    value = int(match.group(1))
                    now = datetime.now(timezone)

                    if unit == 'minutes':
                        due_date = now + timedelta(minutes=value)
                    elif unit == 'hours':
                        due_date = now + timedelta(hours=value)
                    elif unit == 'days':
                        due_date = now + timedelta(days=value)
                    elif unit == 'weeks':
                        due_date = now + timedelta(weeks=value)
                    else:
                        return None

                    return due_date.astimezone(pytz.UTC)
                except ValueError:
                    return None

        return None

    @staticmethod
    async def handle_task_input(update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Process natural language task input with smart parsing and user guidance"""
        telegram_id = str(update.effective_user.id)
        user_input = update.message.text.strip()

        logger.info(f"Task input from {telegram_id}: {user_input}")

        # Check if user is entering timezone
        if context.user_data.get('awaiting_timezone'):
            return await TaskManager.handle_timezone_input(update, context, user_input)

        # Load user's default timezone (from persistent storage)
        timezone_str = await load_user_timezone(telegram_id, context)
        context.user_data['user_timezone'] = timezone_str

        # Check for time format issues and provide guidance
        format_issues = TaskManager.detect_time_format_issues(user_input)
        if format_issues:
            guidance_message = (
                f"🛠️ **Time Format Issues Detected**\n\n"
                f"{format_issues}\n\n"
                f"🌍 **Your timezone:** {timezone_str}\n\n"
                "💡 **Correct Format Examples:**\n"
                "• \"tomorrow 3:00pm\"\n"
                "• \"next friday at 14:30\"\n"
                "• \"december 25 10:00am\"\n"
                "• \"in 2 days at 9:30\"\n"
                "• \"in 5 minutes\"\n"
                "• \"in 1 hour\"\n\n"
                "✨ **Please try again with the correct format:**"
            )

            keyboard = [
                [InlineKeyboardButton(
                    "🔄 Try Again", callback_data="reset_time")],
                [InlineKeyboardButton(
                    "⏰ Skip Due Date", callback_data="create_task")],
                [InlineKeyboardButton(
                    "🌍 Change Timezone", callback_data="reset_time")],
                [InlineKeyboardButton("❌ Cancel", callback_data="cancel_task")]
            ]

            await TaskManager.send_message(
                update,
                guidance_message,
                reply_markup=InlineKeyboardMarkup(keyboard)
            )
            return TASK_DESCRIPTION

        # Smart date parsing with user's timezone
        try:
            user_tz = pytz.timezone(timezone_str)
        except:
            user_tz = pytz.UTC

        # First try relative time parsing (for immediate timeframes)
        relative_due_date = TaskManager.parse_relative_time(
            user_input, user_tz)
        if relative_due_date:
            task_name = TaskManager.clean_task_description(user_input)

            # Store task data
            context.user_data['current_task'] = {
                'raw_input': user_input,
                'name': task_name,
                'due_date': relative_due_date,
                'parsed_date': True,
                'timezone': timezone_str
            }

            # Create beautiful task review card
            return await TaskManager.show_task_review(update, context)

        # If not relative time, try regular date parsing
        parse_result = TaskManager.smart_date_parse(user_input, user_tz)

        if parse_result['status'] == 'error':
            # Show detailed error guidance
            return await TaskManager.show_time_parsing_error(update, context, user_input, parse_result['error'])

        due_date = parse_result['due_date']
        task_name = parse_result['task_name']

        # Store task data
        context.user_data['current_task'] = {
            'raw_input': user_input,
            'name': task_name,
            'due_date': due_date,
            'parsed_date': parse_result['status'] == 'success',
            'timezone': timezone_str
        }

        # Create beautiful task review card
        return await TaskManager.show_task_review(update, context)

    @staticmethod
    async def show_timezone_selection(update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Show timezone selection with clear one-time setup message"""
        timezone_text = (
            "🌍 **ONE-TIME TIMEZONE SETUP** 🌍\n\n"
            "📌 **Important:** This is a **one-time setup**!\n"
            "• Your timezone will be saved as your default\n"
            "• All future tasks will use this timezone automatically\n"
            "• You can change it anytime using /timezone\n\n"
            "✨ **Select your timezone:**"
        )

        # Popular timezones with Africa/Lagos first
        timezones = [
            ("🇳🇬 Lagos (WAT)", "Africa/Lagos"),
            ("🇺🇸 New York (EST)", "America/New_York"),
            ("🇺🇸 Chicago (CST)", "America/Chicago"),
            ("🇺🇸 Los Angeles (PST)", "America/Los_Angeles"),
            ("🇬🇧 London (GMT)", "Europe/London"),
            ("🇪🇺 Paris (CET)", "Europe/Paris"),
            ("🇸🇬 Singapore (SGT)", "Asia/Singapore"),
            ("🇮🇳 Mumbai (IST)", "Asia/Kolkata"),
            ("🇦🇺 Sydney (AEST)", "Australia/Sydney"),
            ("🇯🇵 Tokyo (JST)", "Asia/Tokyo"),
            ("🇨🇳 Shanghai (CST)", "Asia/Shanghai"),
        ]

        keyboard = []
        for i in range(0, len(timezones), 2):
            row = []
            if i < len(timezones):
                row.append(InlineKeyboardButton(
                    timezones[i][0], callback_data=f"tz_{timezones[i][1]}"))
            if i + 1 < len(timezones):
                row.append(InlineKeyboardButton(
                    timezones[i + 1][0], callback_data=f"tz_{timezones[i + 1][1]}"))
            keyboard.append(row)

        keyboard.append([InlineKeyboardButton(
            "🔍 Search More Timezones", callback_data="search_timezones")])
        keyboard.append([InlineKeyboardButton(
            "❌ Cancel", callback_data="cancel_task")])

        await TaskManager.send_message(
            update,
            timezone_text,
            reply_markup=InlineKeyboardMarkup(keyboard)
        )
        return TASK_DESCRIPTION

    @staticmethod
    async def handle_timezone_selection(update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle timezone selection and save as user's default"""
        query = update.callback_query
        await query.answer()

        if query.data == "search_timezones":
            await TaskManager.edit_message(
                update,
                "🔍 **Search Timezones**\n\n"
                "📌 **Remember:** This is a **one-time setup**!\n"
                "Your timezone will be saved as your default.\n\n"
                "Please visit: https://kevinnovak.github.io/Time-Zone-Picker/\n\n"
                "Find your timezone and enter it like:\n"
                "• \"Africa/Lagos\"\n"
                "• \"America/New_York\"\n"
                "• \"Europe/London\"\n\n"
                "✨ **You can change it later using /timezone**"
            )
            context.user_data['awaiting_timezone'] = True
            return TASK_DESCRIPTION

        elif query.data.startswith("tz_"):
            timezone_str = query.data[3:]
            telegram_id = str(query.from_user.id)

            # Save as user's default timezone
            await save_user_timezone(telegram_id, timezone_str, context)
            context.user_data['user_timezone'] = timezone_str

            # Get current time in selected timezone for confirmation
            try:
                user_tz = pytz.timezone(timezone_str)
                current_time = datetime.now(user_tz)
                time_display = current_time.strftime('%Y-%m-%d %H:%M %Z')
            except:
                time_display = "unknown"

            await TaskManager.edit_message(
                update,
                f"✅ **Timezone Successfully Set!**\n\n"
                f"🌍 **Your Timezone:** {timezone_str}\n"
                f"🕐 **Current Time:** {time_display}\n\n"
                f"💾 **Saved as your default timezone!**\n"
                f"📌 **This is a one-time setup** - your timezone is now saved.\n\n"
                f"🔧 **Need to change it later?** Use /timezone\n\n"
                f"📝 **Now, enter your task with a due date:**\n\n"
                f"💡 **Examples:**\n"
                f"• \"Buy groceries tomorrow at 3pm\"\n"
                f"• \"Call John in 1 hour\"\n"
                f"• \"Finish report by next Monday\""
            )
            return TASK_DESCRIPTION

    @staticmethod
    async def handle_timezone_input(update: Update, context: ContextTypes.DEFAULT_TYPE, timezone_input: str):
        """Handle manual timezone input and save as user's default"""
        # Clean the input
        timezone_input = timezone_input.strip().title()
        telegram_id = str(update.effective_user.id)

        # Try to validate the timezone
        try:
            user_tz = pytz.timezone(timezone_input)

            # Save as user's default timezone
            await save_user_timezone(telegram_id, timezone_input, context)
            context.user_data['user_timezone'] = timezone_input
            context.user_data.pop('awaiting_timezone', None)

            current_time = datetime.now(user_tz)
            time_display = current_time.strftime('%Y-%m-%d %H:%M %Z')

            await TaskManager.send_message(
                update,
                f"✅ **Timezone Successfully Set!**\n\n"
                f"🌍 **Your Timezone:** {timezone_input}\n"
                f"🕐 **Current Time:** {time_display}\n\n"
                f"💾 **Saved as your default timezone!**\n\n"
                f"📝 **Next:** Enter your task with a due date\n\n"
                f"💡 **Examples:**\n"
                f"• \"Buy groceries tomorrow at 3pm\"\n"
                f"• \"Call John in 1 hour\"\n"
                f"• \"Finish report by next Monday\"\n\n"
                f"🔧 **Need to change timezone later?** Use /timezone"
            )
            return TASK_DESCRIPTION

        except pytz.UnknownTimeZoneError:
            await TaskManager.send_message(
                update,
                "❌ **Unknown Timezone**\n\n"
                f"\"{timezone_input}\" is not a valid timezone.\n\n"
                "📌 **Remember:** This is a **one-time setup**!\n\n"
                "💡 **Try these formats:**\n"
                "• \"Africa/Lagos\"\n"
                "• \"America/New_York\"\n"
                "• \"Europe/London\"\n\n"
                "✨ **Or select from popular timezones above**"
            )
            return await TaskManager.show_timezone_selection(update, context)

    @staticmethod
    async def show_time_parsing_error(update: Update, context: ContextTypes.DEFAULT_TYPE, user_input: str, error: str):
        """Show helpful error message for time parsing issues"""
        error_guide = (
            f"❌ Time Parsing Error\n\n"
            f"**Your input:** `{user_input}`\n"
            f"**Error:** {error}\n\n"
            "🛠️ **Common Fixes:**\n"
            "• Use clear time formats: \"3:30pm\" not \"3;30\"\n"
            "• Specify AM/PM: \"2pm\" not \"2\"\n"
            "• Use words for months: \"december 25\" not \"25/12\"\n"
            "• Put time after day: \"tomorrow 2pm\" not \"2pm tomorrow\"\n"
            "• No space after colon: \"4:01pm\" not \"4: 01pm\"\n\n"
            "💡 **Working Examples:**\n"
            "• \"tomorrow 3:00pm\"\n"
            "• \"next friday at 14:30\"\n"
            "• \"december 25 10:00am\"\n"
            "• \"in 2 days at 9:30\"\n"
            "• \"in 5 minutes\"\n"
            "• \"in 1 hour\"\n\n"
            "✨ **Try again with a clearer format:**"
        )

        keyboard = [
            [InlineKeyboardButton("🔄 Try Again", callback_data="reset_time")],
            [InlineKeyboardButton(
                "⏰ Skip Due Date", callback_data="create_task")],
            [InlineKeyboardButton("❌ Cancel", callback_data="cancel_task")]
        ]

        await TaskManager.send_message(
            update,
            error_guide,
            reply_markup=InlineKeyboardMarkup(keyboard)
        )
        return TASK_DESCRIPTION

    @staticmethod
    async def show_task_review(update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Show modern task review interface without change time option"""
        task_data = context.user_data['current_task']
        task_name = task_data['name']
        due_date = task_data['due_date']
        has_date = task_data['parsed_date']

        # Create beautiful task card
        task_card = (
            f"📋 **Task Review**\n\n"
            f"📝 **Description:**\n"
            f"{task_name}\n\n"
        )

        if has_date and due_date:
            # Use timezone-aware now for comparison
            now = datetime.now(pytz.UTC)

            if due_date <= now:
                # Past date detected - convert to user's timezone for display
                try:
                    user_tz = pytz.timezone(task_data.get('timezone', 'UTC'))
                    due_date_local = due_date.astimezone(user_tz)
                except:
                    due_date_local = due_date

                task_card += (
                    f"⏰ **Due Date:**\n"
                    f"{due_date_local.strftime('%Y-%m-%d %H:%M')}\n"
                    f"⚠️ **This time has already passed!**\n\n"
                )

                keyboard = [
                    [InlineKeyboardButton(
                        "✅ Create Task Anyway", callback_data="create_task")],
                    [InlineKeyboardButton(
                        "❌ Cancel Task", callback_data="cancel_task")]
                ]
            else:
                # Future date - calculate time difference
                time_until = due_date - now
                days = time_until.days
                hours = time_until.seconds // 3600
                minutes = (time_until.seconds % 3600) // 60

                # Convert to user's timezone for display
                try:
                    user_tz = pytz.timezone(task_data.get('timezone', 'UTC'))
                    due_date_local = due_date.astimezone(user_tz)
                except:
                    due_date_local = due_date

                time_indicator = ""
                if days == 0:
                    if hours == 0:
                        time_indicator = f"🕐 {minutes}m from now"
                    else:
                        time_indicator = f"🕐 {hours}h {minutes}m from now"
                elif days == 1:
                    time_indicator = "📅 Tomorrow"
                else:
                    time_indicator = f"📅 {days} days from now"

                task_card += (
                    f"⏰ **Due Date:**\n"
                    f"{due_date_local.strftime('%Y-%m-%d %H:%M')}\n"
                    f"{time_indicator}\n\n"
                )

                keyboard = [
                    [InlineKeyboardButton(
                        "✅ Create Task", callback_data="create_task")],
                    # [InlineKeyboardButton("📧 Add Email Notifications", callback_data="add_email")],
                    [InlineKeyboardButton(
                        "❌ Cancel", callback_data="cancel_task")]
                ]
        else:
            task_card += "⏰ **No due date set**\n\n"
            keyboard = [
                [InlineKeyboardButton(
                    "✅ Create Task", callback_data="create_task")],
                # [InlineKeyboardButton("📧 Add Email Notifications", callback_data="add_email")],
                [InlineKeyboardButton("❌ Cancel", callback_data="cancel_task")]
            ]

        task_card += "✨ **Choose an option below:**"

        await TaskManager.send_message(
            update,
            task_card,
            reply_markup=InlineKeyboardMarkup(keyboard)
        )
        return TASK_REVIEW

    @staticmethod
    async def handle_task_review_actions(update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle task review button actions - UPDATED TIME HANDLING"""
        query = update.callback_query
        await query.answer()
        action = query.data

        logger.info(f"Task review action: {action}")

        if action == "create_task":
            await TaskManager.edit_message(update, "✨ Creating your encrypted task...")
            return await TaskManager.finalize_task_creation(update, context)

        elif action == "reset_time":
            telegram_id = str(query.from_user.id)
            # Load current timezone to show user what they're changing from
            current_timezone = await load_user_timezone(telegram_id, context)

            await TaskManager.edit_message(
                update,
                f"🌍 Change Timezone\n\n"
                f"Current timezone: {current_timezone}\n\n"
                "Select a new timezone or enter a custom one:"
            )
            return await TaskManager.show_timezone_selection(update, context)

        elif action == "keep_past_date":
            await TaskManager.edit_message(update, "✨ Creating your encrypted task...")
            return await TaskManager.finalize_task_creation(update, context)
        #
        # elif action == "add_email":
        #     return await TaskManager.setup_email_notifications(update, context)

        elif action == "cancel_task":
            await TaskManager.edit_message(update, "❌ Task creation cancelled.")
            context.user_data.clear()
            return ConversationHandler.END

    @staticmethod
    # async def setup_email_notifications(update: Update, context: ContextTypes.DEFAULT_TYPE):
    #     """Setup pay-per-email notifications"""
    #     query = update.callback_query
    #     telegram_id = str(query.from_user.id)
    #
    #     # Check user's premium status
    #     session = await load_user_session(telegram_id, context)
    #     is_premium = session.get('is_premium', False)
    #
    #     if is_premium:
    #         # Premium users get free email notifications
    #         email_setup_text = (
    #             "📧 Email Notifications - Premium 👑\n\n"
    #             "✨ As a premium user, you get:\n"
    #             "• Unlimited email notifications\n"
    #             "• Task confirmations & reminders\n"
    #             "• Priority delivery\n\n"
    #             "Please enter your email address:"
    #         )
    #     else:
    #         # Basic users pay per email
    #         email_setup_text = (
    #             "📧 Email Notifications - Pay Per Use\n\n"
    #             "💡 How it works:\n"
    #             f"• Only {EMAIL_NOTIFICATION_PRICE} SUI per email\n"
    #             "• Pay only when emails are sent\n"
    #             "• No subscription required\n\n"
    #             "📨 You'll be charged for:\n"
    #             "• Task creation confirmation\n"
    #             "• Reminder notifications\n"
    #             "• Completion receipts\n\n"
    #             "💰 Want unlimited emails? Use /upgrade\n\n"
    #             "Please enter your email address:"
    #         )
    #
    #     await TaskManager.edit_message(update, email_setup_text)
    #     return EMAIL_SETUP
    #
    # @staticmethod
    # async def handle_email_input(update: Update, context: ContextTypes.DEFAULT_TYPE):
    #     """Process email input and setup payment if needed"""
    #     telegram_id = str(update.effective_user.id)
    #     email = update.message.text.strip()
    #
    #     if not is_valid_email(email):
    #         await TaskManager.send_message(
    #             update,
    #             "❌ Invalid Email Format\n\n"
    #             "Please check:\n"
    #             "• Valid format (user@domain.com)\n"
    #             "• No typos (.com not .comm)\n"
    #             "• Lowercase local part\n\n"
    #             "✨ Try again:"
    #         )
    #         return EMAIL_SETUP
    #
    #     context.user_data['notification_email'] = email
    #
    #     # Check if user is premium
    #     session = await load_user_session(telegram_id, context)
    #     is_premium = session.get('is_premium', False)
    #
    #     if is_premium:
    #         # Premium users skip payment
    #         context.user_data['email_notifications'] = True
    #         return await TaskManager.finalize_task_creation(update, context)
    #     else:
    #         # Basic users need to confirm payment
    #         return await TaskManager.show_payment_confirmation(update, context)
    #
    # @staticmethod
    # async def show_payment_confirmation(update: Update, context: ContextTypes.DEFAULT_TYPE):
    #     """Show payment confirmation for email notifications"""
    #     task_data = context.user_data['current_task']
    #     email = context.user_data['notification_email']
    #
    #     payment_text = (
    #         "💰 Payment Confirmation\n\n"
    #         f"📧 Email: {email}\n"
    #         f"📝 Task: {task_data['name'][:50]}...\n\n"
    #         f"💸 Cost: {EMAIL_NOTIFICATION_PRICE} SUI per email\n"
    #         f"💡 You'll be charged when emails are sent\n\n"
    #         "✨ Benefits:\n"
    #         "• Email confirmations\n"
    #         "• Reminder notifications\n"
    #         "• Completion receipts\n\n"
    #         "🔐 Payment is secure and on-chain"
    #     )
    #
    #     keyboard = [
    #         [InlineKeyboardButton("✅ Confirm Payment", callback_data="confirm_payment"),
    #          InlineKeyboardButton("🚫 Skip Email", callback_data="skip_email")],
    #         [InlineKeyboardButton("💎 Upgrade to Premium", callback_data="premium_upsell")]
    #     ]
    #
    #     await TaskManager.send_message(
    #         update,
    #         payment_text,
    #         reply_markup=InlineKeyboardMarkup(keyboard)
    #     )
    #     return PAYMENT_CONFIRM
    #
    # @staticmethod
    # async def handle_payment_confirmation(update: Update, context: ContextTypes.DEFAULT_TYPE):
    #     """Handle payment confirmation actions"""
    #     query = update.callback_query
    #     await query.answer()
    #     action = query.data
    #
    #     if action == "confirm_payment":
    #         context.user_data['email_notifications'] = True
    #         context.user_data['pay_per_email'] = True
    #         await TaskManager.edit_message(
    #             update,
    #             "✅ Payment Setup Complete!\n\n"
    #             "📧 Email notifications are now enabled\n"
    #             f"💸 You'll be charged {EMAIL_NOTIFICATION_PRICE} SUI per email\n\n"
    #             "✨ Creating your encrypted task..."
    #         )
    #         return await TaskManager.finalize_task_creation(update, context)
    #     elif action == "skip_email":
    #         context.user_data['email_notifications'] = False
    #         await TaskManager.edit_message(
    #             update,
    #             "📧 Email notifications skipped\n\n"
    #             "✨ Creating your encrypted task..."
    #         )
    #         return await TaskManager.finalize_task_creation(update, context)
    #     elif action == "premium_upsell":
    #         await TaskManager.edit_message(
    #             update,
    #             "💎 Go Premium - Unlimited Everything!\n\n"
    #             "✨ Premium Benefits:\n"
    #             "• Unlimited email notifications\n"
    #             "• No per-email fees\n"
    #             "• Advanced encryption features\n"
    #             "• Priority support\n"
    #             "• Increased task limits\n\n"
    #             f"💰 Only {PREMIUM_MONTHLY} SUI/month\n\n"
    #             "🚀 Upgrade now with /upgrade\n\n"
    #             "✨ You can still continue with pay-per-email",
    #             reply_markup=InlineKeyboardMarkup([
    #                 [InlineKeyboardButton("✅ Continue with Pay-Per-Email", callback_data="confirm_payment")],
    #                 [InlineKeyboardButton("🚫 Skip Email", callback_data="skip_email")]
    #             ])
    #         )
    #         return PAYMENT_CONFIRM
    @staticmethod
    async def finalize_task_creation(update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Finalize task creation with encryption and timezone reminder"""
        telegram_id = str(update.effective_user.id)
        task_data = context.user_data['current_task']

        try:
            session = await load_user_session(telegram_id, context)
            if not session or not session.get('profile_id'):
                error_msg = "❌ Profile not found. Please use /start first."
                await TaskManager.send_message(update, error_msg)
                return ConversationHandler.END

            # Guaranteed to be a valid Sui address
            profile_id = session['profile_id']

            # Get user's public key
            public_key = key_manager.get_user_public_key(telegram_id)
            if not public_key:
                error_msg = "Encryption keys not found."
                await TaskManager.send_message(update, error_msg)
                return ConversationHandler.END

            # Prepare encrypted task data
            task_details = {
                'task_name': task_data['name'],
                'description': task_data['raw_input'],
                'created_by': telegram_id,
                'created_at': datetime.now(pytz.UTC).isoformat(),
                'due_date': task_data['due_date'].isoformat() if task_data['due_date'] else None,
                'priority': 'normal',
                'status': 'pending',
                'has_email_notifications': context.user_data.get('email_notifications', False),
                'pay_per_email': context.user_data.get('pay_per_email', False)
            }

            # Encrypt and store
            encrypted_blob_id = walrus.store_encrypted_task(
                public_key, task_details)
            if not encrypted_blob_id:
                error_msg = "❌ Error encrypting task."
                await TaskManager.send_message(update, error_msg)
                return ConversationHandler.END

            # Create on blockchain
            due_timestamp = int(task_data['due_date'].timestamp(
            ) * 1000) if task_data['due_date'] else 0
            task_id = sui.create_task(
                profile_id, encrypted_blob_id, due_timestamp)

            if not task_id:
                error_msg = "❌ Error creating task."
                await TaskManager.send_message(update, error_msg)
                return ConversationHandler.END

            # Send success message with timezone reminder
            success_message = await TaskManager.create_success_card(
                task_data, task_id, encrypted_blob_id, context
            )

            # Add timezone change reminder
            user_timezone = await load_user_timezone(telegram_id, context)
            timezone_reminder = f"\n\n🌍 **Your timezone:** {user_timezone}\n🔧 **Need to change timezone?** Use /timezone"

            # Setup reminders
            if task_data['due_date']:
                await TaskManager.setup_reminders(context, telegram_id, task_id, task_data)

            # Clear context
            context.user_data.clear()

            # Send success message with timezone reminder
            await TaskManager.send_message(update, success_message + timezone_reminder)

            await save_user_session(telegram_id, context)
            return ConversationHandler.END
        except Exception as e:
            error_msg = f"❌ Failed to create task: {str(e)}"
            logger.error(
                f"Error finalizing task creation for {telegram_id}: {e}", exc_info=True)
            await TaskManager.send_message(update, error_msg)
            return ConversationHandler.END

    @staticmethod
    async def create_success_card(task_data: Dict, task_id: str, encrypted_blob_id: str,
                                  context: ContextTypes.DEFAULT_TYPE) -> str:
        """Create beautiful success message"""
        card = (
            f"🎉 **Task Created Successfully!**\n\n"
            f"📝 **Task:** {task_data['name']}\n"
        )

        if task_data['due_date']:
            # Convert to user's timezone for display
            try:
                user_timezone = await load_user_timezone(task_data.get('created_by', ''), context)
                user_tz = pytz.timezone(user_timezone)
                due_date_local = task_data['due_date'].astimezone(user_tz)
                card += f"⏰ **Due:** {due_date_local.strftime('%Y-%m-%d %H:%M')}\n"
            except:
                card += f"⏰ **Due:** {task_data['due_date'].strftime('%Y-%m-%d %H:%M')}\n"

        card += f"🔐 **Encrypted:** ✅ Secure\n"

        card += f"💾 **Storage:** Walrus Network\n\n"

        # card += "💡 Use /my_tasks to view tasks"

        # if context.user_data.get('email_notifications'):
        #     if context.user_data.get('pay_per_email'):
        #         card += f"📧 **Notifications:** Pay-per-email ({EMAIL_NOTIFICATION_PRICE} SUI)\n"
        #     else:
        #         card += "📧 **Notifications:** Premium (Unlimited) 👑\n"
        # else:
        #     card += "📧 **Notifications:** In-app only\n"

        # card += f"\n✨ **Task ID:** {task_id[:16]}...\n"
        return card

    @staticmethod
    async def setup_reminders(context: ContextTypes.DEFAULT_TYPE, user_id: str, task_id: str, task_data: Dict):
        """Setup smart reminders with proper job scheduling"""
        try:
            due_date = task_data['due_date']
            if not due_date:
                return

            # Use UTC for comparison
            now_utc = datetime.now(pytz.UTC)

            # Check if date is in past
            if due_date <= now_utc:
                # Convert to user's timezone for display
                try:
                    user_tz = pytz.timezone(task_data.get('timezone', 'UTC'))
                    due_date_local = due_date.astimezone(user_tz)
                except:
                    due_date_local = due_date

                # Send immediate notification for past due dates
                try:
                    await context.bot.send_message(
                        chat_id=int(user_id),
                        text=(
                            f"⏰ Immediate Notification\n\n"
                            f"Task '{task_data['name']}' was due at {due_date_local.strftime('%Y-%m-%d %H:%M')}\n\n"
                            f"💡 This is a past due date reminder!"
                        )
                    )
                except Exception as e:
                    logger.error(f"Error sending immediate notification: {e}")
                return

            # Calculate delay in seconds for future reminders
            delay_seconds = (due_date - now_utc).total_seconds()

            # Only schedule if it's in the future
            if delay_seconds > 0:
                # Schedule future reminder
                context.job_queue.run_once(
                    TaskManager.send_reminder_callback,
                    when=delay_seconds,
                    data={
                        'user_id': int(user_id),  # Ensure user_id is integer
                        'task_id': task_id,
                        'task_name': task_data['name'],
                        'due_date': due_date.isoformat()  # Store as string to avoid serialization issues
                    },
                    name=f"reminder_{task_id}"
                )

                logger.info(
                    f"Reminder scheduled for task {task_id} at {due_date} (in {delay_seconds:.0f} seconds)")

        except Exception as e:
            logger.error(f"Error setting up reminder: {e}")

    @staticmethod
    async def send_reminder_callback(context: ContextTypes.DEFAULT_TYPE):
        """Send reminder callback - FIXED VERSION"""
        try:
            job = context.job
            data = job.data

            # Parse the due_date back from string
            due_date = datetime.fromisoformat(
                data['due_date']).replace(tzinfo=pytz.UTC)

            reminder_text = (
                f"🔔 Task Reminder!\n\n"
                f"📝 {data['task_name']}\n"
                f"⏰ Due: {due_date.strftime('%Y-%m-%d %H:%M UTC')}\n\n"
                f"💡 Time to complete your task!"
            )

            logger.info(
                f"Sending reminder to user {data['user_id']} for task {data['task_id']}")

            await context.bot.send_message(
                chat_id=data['user_id'],
                text=reminder_text
            )

            logger.info(
                f"Reminder sent successfully for task {data['task_id']}")

        except Exception as e:
            logger.error(f"Error in send_reminder_callback: {e}")

    @staticmethod
    def clean_task_description(text: str) -> str:
        """Clean task description by removing date-related words"""
        # Common date/time words to remove
        date_words = [
            'tomorrow', 'today', 'yesterday', 'next', 'last',
            'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
            'january', 'february', 'march', 'april', 'may', 'june', 'july',
            'august', 'september', 'october', 'november', 'december',
            'am', 'pm', 'at', 'on', 'by', 'in', 'after', 'from', 'now'
        ]

        words = text.split()
        cleaned_words = [word for word in words if word.lower()
                         not in date_words]
        return ' '.join(cleaned_words) if cleaned_words else text


async def complete_task_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Modern complete task interface"""
    telegram_id = str(update.effective_user.id)

    try:
        session = await load_user_session(telegram_id, context)
        profile_id = session.get('profile_id')

        if not profile_id:
            await TaskManager.send_message(
                update,
                "❌ Profile Required\n\n"
                "Please use /start to create your profile first."
            )
            return ConversationHandler.END

        # Get user's tasks
        user_address = context.user_data.get('user_address', telegram_id)
        tasks = sui.get_user_tasks(user_address)
        pending_tasks = [t for t in tasks if t.get('status') == 'pending']

        if not pending_tasks:
            await TaskManager.send_message(
                update,
                "📝 No Active Tasks\n\n"
                "You have no tasks to complete.\n\n"
                "✨ Create a new task: /new_task"
            )
            return ConversationHandler.END

        # Create modern task selection
        keyboard = []
        for task in pending_tasks[:8]:  # Limit to 8 for better UX
            task_id = task.get('id', 'unknown')
            task_name = "🔒 Encrypted Task"

            # Try to decrypt task name
            user_password = context.user_data.get('password')
            if user_password:
                private_key = await get_user_private_key(telegram_id, user_password)
                if private_key:
                    encrypted_blob = task.get('encrypted_details_blob')
                    if encrypted_blob:
                        try:
                            decrypted_task = walrus.retrieve_encrypted_task(
                                encrypted_blob, private_key)
                            if decrypted_task:
                                task_name = decrypted_task.get(
                                    'task_name', task_name)[:30] + "..."
                        except Exception:
                            pass

            keyboard.append([InlineKeyboardButton(
                f"✅ {task_name}", callback_data=f"complete_{task_id}")])

        keyboard.append([InlineKeyboardButton(
            "❌ Cancel", callback_data='cancel_complete')])

        await TaskManager.send_message(
            update,
            "🎯 Complete a Task\n\n"
            "Select a task to mark as completed:",
            reply_markup=InlineKeyboardMarkup(keyboard)
        )
        return SELECT_TASK

    except Exception as e:
        logger.error(f"Error in complete_task_command: {e}")
        await TaskManager.send_message(
            update,
            "❌ Error Loading Tasks\n\n"
            "Please try again later."
        )
        return ConversationHandler.END


async def handle_complete_task(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle task completion with modern UI and better error handling"""
    query = update.callback_query
    await query.answer()
    telegram_id = str(query.from_user.id)
    callback_data = query.data

    if callback_data == 'cancel_complete':
        await TaskManager.edit_message(
            update,
            "❌ Task Completion Cancelled\n\n"
            "No tasks were marked as completed.\n\n"
            "✨ You can always complete tasks later with /complete_task"
        )
        return ConversationHandler.END

    if callback_data.startswith('complete_'):
        task_id = callback_data[len('complete_'):]
        logger.info(
            f"User {telegram_id} attempting to complete task {task_id}")

        try:
            # Load user session
            session = await load_user_session(telegram_id, context)
            if not session or not session.get('profile_id'):
                await TaskManager.edit_message(
                    update,
                    "❌ Profile Not Found\n\n"
                    "Please use /start to create your profile first."
                )
                return ConversationHandler.END

            profile_id = session.get('profile_id')

            # Complete task on blockchain
            logger.info(f"Completing task {task_id} for profile {profile_id}")
            success = sui.complete_task(task_id, profile_id)

            if success:
                # Try to get task name for confirmation
                task_name = "your task"
                try:
                    user_password = session.get(
                        'password') or context.user_data.get('password')
                    if user_password:
                        private_key = await get_user_private_key(telegram_id, user_password)
                        if private_key:
                            task_details = sui.get_task_details(task_id)
                            if task_details:
                                encrypted_blob = task_details.get(
                                    'encrypted_details_blob')
                                if encrypted_blob:
                                    decrypted_task = walrus.retrieve_encrypted_task(
                                        encrypted_blob, private_key)
                                    if decrypted_task:
                                        task_name = decrypted_task.get(
                                            'task_name', task_name)
                except Exception as e:
                    logger.error(
                        f"Error decrypting task for completion confirmation: {e}")
                    # Continue even if decryption fails

                # Send beautiful success message
                completion_message = (
                    f"🎉 Task Completed!\n\n"
                    f"✅ {task_name}\n\n"
                    f"⭐ +1 point earned!\n"
                    f"🔐 Securely recorded on blockchain\n\n"
                    f"💡 Keep up the great work!"
                )

                await TaskManager.edit_message(update, completion_message)

                # Update points in session
                current_points = session.get('points', 0)
                session['points'] = current_points + 1
                await save_user_session(telegram_id, context)

            else:
                await TaskManager.edit_message(
                    update,
                    "❌ Error Completing Task\n\n"
                    "Could not mark the task as completed.\n\n"
                    "Possible reasons:\n"
                    "• Task doesn't exist\n"
                    "• Task already completed\n"
                    "• Blockchain error\n\n"
                    "✨ Please try again or check with /my_tasks"
                )

            return ConversationHandler.END

        except Exception as e:
            logger.error(f"Error completing task: {e}")
            await TaskManager.edit_message(
                update,
                "❌ Error Completing Task\n\n"
                "An unexpected error occurred.\n\n"
                "✨ Please try again later or contact support."
            )
            return ConversationHandler.END


async def my_tasks_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show user's tasks with better error handling"""
    telegram_id = str(update.effective_user.id)

    try:
        # Load user session first
        session = await load_user_session(telegram_id, context)
        if not session or not session.get('profile_id'):
            await TaskManager.send_message(
                update,
                "❌ Profile Required\n\n"
                "Please use /start to create your profile first."
            )
            return

        profile_id = session.get('profile_id')

        # Get user's tasks
        # Use session instead of context.user_data
        user_address = session.get('user_address', telegram_id)
        tasks = sui.get_user_tasks(user_address)

        if not tasks:
            await TaskManager.send_message(
                update,
                "📝 No Tasks Found\n\n"
                "✨ Create your first task: /new_task"
            )
            return

        # Group tasks by status
        pending_tasks = [t for t in tasks if t.get('status') == 'pending']
        completed_tasks = [t for t in tasks if t.get('status') == 'completed']

        task_list = "📋 Your Tasks\n\n"

        if pending_tasks:
            task_list += "🟡 **Pending Tasks:**\n"
            for i, task in enumerate(pending_tasks[:10], 1):
                task_name = "🔒 Encrypted Task"
                task_id = task.get('id', 'unknown')

                # Try to get decrypted task name
                try:
                    # Get encrypted blob
                    encrypted_blob = task.get('encrypted_details_blob')
                    if encrypted_blob:
                        # Try to decrypt using session data
                        user_password = session.get(
                            'password')  # Try session first
                        if not user_password:
                            user_password = context.user_data.get(
                                'password')  # Fallback to context

                        if user_password:
                            private_key = await get_user_private_key(telegram_id, user_password)
                            if private_key:
                                decrypted_task = walrus.retrieve_encrypted_task(
                                    encrypted_blob, private_key)
                                if decrypted_task:
                                    task_name = decrypted_task.get(
                                        'task_name', 'Unknown Task')[:50]
                except Exception as e:
                    logger.error(f"Error decrypting task {task_id}: {e}")
                    task_name = "🔒 [Decryption Failed]"

                due_date = task.get('due_date')
                if due_date:
                    try:
                        if isinstance(due_date, int):
                            due_date = datetime.fromtimestamp(due_date / 1000)
                        due_str = due_date.strftime('%Y-%m-%d %H:%M')
                    except:
                        due_str = "Unknown"
                else:
                    due_str = "No due date"

                task_list += f"{i}. {task_name}\n   ⏰ {due_str}\n   ID: {task_id[:8]}...\n\n"

        if completed_tasks:
            task_list += "✅ **Completed Tasks:**\n"
            for i, task in enumerate(completed_tasks[:5], 1):
                task_name = "🔒 Encrypted Task"
                task_id = task.get('id', 'unknown')

                # Try to decrypt
                try:
                    encrypted_blob = task.get('encrypted_details_blob')
                    if encrypted_blob:
                        user_password = session.get(
                            'password') or context.user_data.get('password')
                        if user_password:
                            private_key = await get_user_private_key(telegram_id, user_password)
                            if private_key:
                                decrypted_task = walrus.retrieve_encrypted_task(
                                    encrypted_blob, private_key)
                                if decrypted_task:
                                    task_name = decrypted_task.get(
                                        'task_name', 'Unknown Task')[:50]
                except Exception as e:
                    logger.error(
                        f"Error decrypting completed task {task_id}: {e}")
                    task_name = "🔒 [Decryption Failed]"

                task_list += f"{i}. {task_name}\n   ID: {task_id[:8]}...\n\n"

        if len(pending_tasks) > 10:
            task_list += f"\n... and {len(pending_tasks) - 10} more pending tasks\n"

        task_list += f"\n📊 **Summary:**\n"
        task_list += f"• Pending: {len(pending_tasks)}\n"
        task_list += f"• Completed: {len(completed_tasks)}\n"
        task_list += f"• Total: {len(tasks)}\n\n"
        task_list += "💡 Use /complete_task to mark tasks as completed"

        await TaskManager.send_message(update, task_list)

    except Exception as e:
        logger.error(f"Error in my_tasks_command: {e}")
        await TaskManager.send_message(
            update,
            "❌ Error Loading Tasks\n\n"
            "Please try again later or check if you've completed setup with /start"
        )


async def timezone_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Command to view and change user's timezone"""
    telegram_id = str(update.effective_user.id)

    try:
        current_timezone = await load_user_timezone(telegram_id, context)

        # Get current time in user's timezone
        try:
            user_tz = pytz.timezone(current_timezone)
            current_time = datetime.now(user_tz)
            time_display = current_time.strftime('%Y-%m-%d %H:%M %Z')
        except:
            time_display = "unknown"

        message = (
            f"🌍 **Your Timezone Settings**\n\n"
            f"**Current Timezone:** {current_timezone}\n"
            f"**Current Time:** {time_display}\n\n"
            f"💡 **Want to change your timezone?**\n\n"
            f"Select a new timezone below:"
        )

        # Timezone selection keyboard
        timezones = [
            ("🇳🇬 Lagos (WAT)", "Africa/Lagos"),
            ("🇺🇸 New York (EST)", "America/New_York"),
            ("🇺🇸 Chicago (CST)", "America/Chicago"),
            ("🇺🇸 Los Angeles (PST)", "America/Los_Angeles"),
            ("🇬🇧 London (GMT)", "Europe/London"),
            ("🇪🇺 Paris (CET)", "Europe/Paris"),
            ("🇸🇬 Singapore (SGT)", "Asia/Singapore"),
            ("🇮🇳 Mumbai (IST)", "Asia/Kolkata"),
        ]

        keyboard = []
        for i in range(0, len(timezones), 2):
            row = []
            if i < len(timezones):
                row.append(InlineKeyboardButton(
                    timezones[i][0], callback_data=f"change_tz_{timezones[i][1]}"))
            if i + 1 < len(timezones):
                row.append(InlineKeyboardButton(
                    timezones[i + 1][0], callback_data=f"change_tz_{timezones[i + 1][1]}"))
            keyboard.append(row)

        keyboard.append([InlineKeyboardButton(
            "🔍 Search More Timezones", callback_data="change_tz_search")])
        keyboard.append([InlineKeyboardButton(
            "❌ Cancel", callback_data="change_tz_cancel")])

        await update.message.reply_text(
            message,
            reply_markup=InlineKeyboardMarkup(keyboard)
        )

    except Exception as e:
        logger.error(f"Error in timezone_command: {e}")
        await update.message.reply_text(
            "❌ Error loading timezone settings\n\n"
            "Please try again later."
        )


async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Modern cancel handler for both command and conversation"""
    await TaskManager.send_message(
        update,
        "❌ Operation Cancelled\n\n"
        "The current operation has been cancelled.\n\n"
        "✨ What would you like to do next?\n"
        "• /new_task - Create a new task\n"
        "• /my_tasks - View your tasks\n"
        "• /profile - Check your profile"
    )
    context.user_data.clear()
    return ConversationHandler.END


task_conv_handler = ConversationHandler(
    entry_points=[
        CommandHandler('new_task', TaskManager.create_modern_task_ui),
    ],
    states={
        TASK_DESCRIPTION: [
            MessageHandler(filters.TEXT & ~filters.COMMAND,
                           TaskManager.handle_task_input),
            CallbackQueryHandler(
                TaskManager.handle_timezone_selection, pattern='^tz_.*|^search_timezones$'),
            CallbackQueryHandler(
                TaskManager.handle_task_review_actions, pattern='^reset_time$'),
            CallbackQueryHandler(
                TaskManager.handle_task_review_actions, pattern='^cancel_task$')
        ],
        TASK_REVIEW: [
            CallbackQueryHandler(
                TaskManager.handle_task_review_actions,
                pattern='^(create_task|reset_time|keep_past_date|add_email|cancel_task)$'
            )
        ],
        # EMAIL_SETUP: [
        #     MessageHandler(filters.TEXT & ~filters.COMMAND, TaskManager.handle_email_input),
        #     CallbackQueryHandler(TaskManager.handle_task_review_actions, pattern='^cancel_task$')
        # ],
        # PAYMENT_CONFIRM: [
        #     CallbackQueryHandler(
        #         TaskManager.handle_payment_confirmation,
        #         pattern='^(confirm_payment|skip_email|premium_upsell)$'
        #     ),
        #     CallbackQueryHandler(TaskManager.handle_task_review_actions, pattern='^cancel_task$')
        # ],
        SELECT_TASK: [
            CallbackQueryHandler(handle_complete_task,
                                 pattern='^complete_.*|^cancel_complete$')
        ]
    },
    fallbacks=[CommandHandler('cancel', cancel)],
    allow_reentry=True
)
setup_callback_handler = CallbackQueryHandler(
    TaskManager.handle_setup_callbacks,
    pattern='^(guide_start|guide_setup_password|learn_features|learn_encryption|cancel_setup)$'
)
complete_task_handler = CommandHandler('complete_task', complete_task_command)
