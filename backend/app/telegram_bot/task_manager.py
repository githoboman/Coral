from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CommandHandler, MessageHandler, CallbackQueryHandler, ConversationHandler, \
    filters
from datetime import datetime, timedelta
import pytz
from parsedatetime import Calendar
import re
import html
from app.telegram_bot.utils import authenticate_user
from app.telegram_bot.encrypted_db import get_user_tasks, update_task_status
from typing import Dict, Optional

from app.telegram_bot.utils import (
    get_walrus_client, get_key_manager, get_sui_client,
    is_valid_email,
    ensure_user_has_keys, get_user_private_key,
    load_user_session, save_user_session, save_user_timezone, load_user_timezone
)

# Initialize encrypted storage clients
walrus = get_walrus_client()
key_manager = get_key_manager()
sui = get_sui_client()

# Conversation states
TASK_DESCRIPTION, TASK_REVIEW, EMAIL_SETUP, PAYMENT_CONFIRM, SELECT_TASK = range(5)

# Pricing configuration
EMAIL_NOTIFICATION_PRICE = 0.01
PREMIUM_MONTHLY = 5.00

# Task limits configuration
DAILY_TASK_LIMIT = 5
DAILY_POINTS_LIMIT = 4
PORTFOLIO_COOLDOWN_HOURS = 24


class TaskManager:
    """Modern task management with payment features"""

    @staticmethod
    async def check_user_setup(telegram_id: str, context: ContextTypes.DEFAULT_TYPE) -> tuple:
        """
        Check if user has complete setup for task creation.
        Returns: (is_ready: bool, session: dict, missing_step: str)
        """
        try:
            # Check if user has a valid session
            session = await load_user_session(telegram_id, context)
            if not session:
                return False, None, "profile"

            # Check if registration is complete
            if not session.get('registration_complete'):
                return False, session, "profile"

            # Check if profile_id exists (blockchain registration)
            if not session.get('profile_id'):
                return False, session, "profile"

            # ✅ FIX: Check encryption keys - use the same method as registration
            # This ensures consistency between registration and task creation
            has_keys = await ensure_user_has_keys(telegram_id, context)
            if not has_keys:
                return False, session, "encryption"

            # Load user's default timezone
            user_timezone = await load_user_timezone(telegram_id, context)
            if not user_timezone or user_timezone == 'UTC':  # 'UTC' means never chosen
                return False, session, "timezone"

            return True, session, None

        except Exception as e:
            return False, None, "error"

    @staticmethod
    async def can_create_task_today(telegram_id: str, context: ContextTypes.DEFAULT_TYPE) -> tuple:
        """REAL task counting from encrypted DB - SIMPLE VERSION"""
        try:
            from encrypted_db import get_daily_task_count

            current_count = get_daily_task_count(telegram_id)
            remaining = max(0, DAILY_TASK_LIMIT - current_count)
            can_create = current_count < DAILY_TASK_LIMIT

            return can_create, current_count, remaining

        except Exception as e:
            # Fallback: allow creation but log error
            return True, 0, DAILY_TASK_LIMIT

    @staticmethod
    async def can_earn_task_points_today(telegram_id: str, context: ContextTypes.DEFAULT_TYPE) -> tuple:
        """
        Check if user can earn task completion points today.
        Returns: (can_earn: bool, last_task_time: datetime, next_available: datetime)
        """
        try:
            session = await load_user_session(telegram_id, context)
            if not session:
                return True, None, None

            now_utc = datetime.now(pytz.UTC)

            # Check session data for last task completion with points
            last_task_str = session.get('last_task_points_time')
            if last_task_str:
                try:
                    last_task = datetime.fromisoformat(last_task_str.replace('Z', '+00:00'))
                    time_since_last = now_utc - last_task
                    if time_since_last < timedelta(hours=PORTFOLIO_COOLDOWN_HOURS):
                        next_available = last_task + timedelta(hours=PORTFOLIO_COOLDOWN_HOURS)
                        return False, last_task, next_available
                except Exception:
                    pass

            return True, None, None

        except Exception:
            return True, None, None

    @staticmethod
    async def award_task_points(user_id: str, context: ContextTypes.DEFAULT_TYPE) -> bool:
        """
        Award points for task completion and update all data stores.
        Returns: True if points were awarded successfully
        """
        try:
            session = await load_user_session(user_id, context)
            if not session:
                return False

            now_utc = datetime.now(pytz.UTC)

            # Update session with points and timestamp
            current_points = session.get('points', 0)
            session['points'] = current_points + DAILY_POINTS_LIMIT
            session['last_task_points_time'] = now_utc.isoformat()
            session['tasks_completed'] = session.get('tasks_completed', 0) + 1

            # Save updated session
            await save_user_session(user_id, session)

            return True

        except Exception:
            return False

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
                return None
        except Exception:
            return None

    @staticmethod
    async def edit_message(update: Update, text: str, reply_markup=None, parse_mode=None):
        """Universal method to edit messages for CallbackQuery updates"""
        try:
            if hasattr(update, 'callback_query') and update.callback_query:
                return await update.callback_query.edit_message_text(
                    text,
                    reply_markup=reply_markup,
                    parse_mode=parse_mode
                )
            else:
                # If it's not a callback query, send a new message instead
                return await TaskManager.send_message(update, text, reply_markup, parse_mode)
        except Exception:
            return None

    @staticmethod
    async def send_message(update: Update, text: str, reply_markup=None, parse_mode=None):
        """Universal method to send messages for both Message and CallbackQuery updates"""
        try:
            if hasattr(update, 'message') and update.message:
                # This is a Message update
                return await update.message.reply_text(
                    text,
                    reply_markup=reply_markup,
                    parse_mode=parse_mode
                )
            elif hasattr(update, 'callback_query') and update.callback_query:
                # This is a CallbackQuery update
                if update.callback_query.message:
                    return await update.callback_query.message.reply_text(
                        text,
                        reply_markup=reply_markup,
                        parse_mode=parse_mode
                    )
                else:
                    # Fallback: use bot to send message
                    bot = update.callback_query.bot
                    chat_id = update.callback_query.from_user.id
                    return await bot.send_message(
                        chat_id=chat_id,
                        text=text,
                        reply_markup=reply_markup,
                        parse_mode=parse_mode
                    )
            else:
                return None
        except Exception:
            return None

    @staticmethod
    async def create_modern_task_ui(update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Create beautiful task creation interface with comprehensive setup checks"""
        telegram_id = str(update.effective_user.id)

        # Comprehensive user setup check
        is_ready, session, missing_step = await TaskManager.check_user_setup(telegram_id, context)

        if not is_ready:
            if missing_step == "profile":
                return await TaskManager.show_setup_guide(update, context)
            elif missing_step == "encryption":
                return await TaskManager.show_encryption_setup(update, context)
            elif missing_step == "timezone":
                return await TaskManager.show_timezone_selection(update, context)
            else:
                return await TaskManager.show_generic_error(update, context)

        # Check daily task limit
        can_create, current_count, remaining = await TaskManager.can_create_task_today(telegram_id, context)
        if not can_create:
            await TaskManager.send_message(
                update,
                f"📊 Daily Task Limit Reached\n\n"
                f"You've created {current_count}/{DAILY_TASK_LIMIT} tasks today!\n\n"
                f"🔄 Reset in: Next UTC day (midnight)\n"
                f"✨ In the meantime, you can:\n"
                f"• Check /task_history to view your tasks\n"
                f"• Complete tasks to earn points\n"
                f"• Use /portfolio to check your wallet"
            )
            return ConversationHandler.END

        # User has valid setup and can create tasks
        user_timezone = await load_user_timezone(telegram_id, context)
        context.user_data['user_timezone'] = user_timezone

        await TaskManager.send_message(
            update,
            f"📝 Create New Encrypted Task\n\n"
            f"🌍 Your timezone: {user_timezone}\n"
            f"📊 Tasks today: {current_count}/{DAILY_TASK_LIMIT} ({remaining} left)\n\n"
            f"✨ How it works:\n"
            f"• Describe your task naturally\n"
            f"• We'll detect dates automatically\n"
            f"• Everything is encrypted for privacy\n\n"
            f"💡 **Examples:**\n"
            f"• \"Buy groceries tomorrow at 3pm\"\n"
            f"• \"Call John on Friday 2pm\"\n"
            f"• \"Finish report by next Monday\"\n"
            f"• \"Remind me in 5 minutes\"\n"
            f"• \"Alert me in 1 hour\"\n\n"
            f"🔐 Your data is secure with:\n"
            f"• End-to-end encryption\n"
            f"• Blockchain-backed storage\n"
            f"• Zero-knowledge privacy\n\n"
            f"Simply tell me what you need to do..."
        )
        return TASK_DESCRIPTION

    @staticmethod
    async def show_setup_guide(update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Show interactive setup guide for new users"""
        setup_guide = (
            "👋 **Welcome to Encrypted Tasks!** 🔐\n\n"
            "It looks like you're new here. Let's get you set up quickly:\n\n"
            "🚀 Quick Setup Process:\n"
            "1. Use /start - Create your profile\n"
            "2. Use /start - Secure your data\n"
            "3. Start creating encrypted tasks!\n\n"
            "✨ What you'll get:\n"
            "• End-to-end encrypted task storage\n"
            "• Secure blockchain-backed tasks\n"
            "• Smart reminders and notifications\n"
            "• Daily points for completing tasks\n\n"
            "Ready to begin?"
        )

        keyboard = [
            [InlineKeyboardButton("🚀 Use /start", callback_data="guide_start")],
            [InlineKeyboardButton("📚 Learn Features", callback_data="learn_features")],
            [InlineKeyboardButton("❌ Maybe Later", callback_data="cancel_setup")]
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
            [InlineKeyboardButton("🔐 Use /start", callback_data="guide_setup_password")],
            [InlineKeyboardButton("📖 How Encryption Works", callback_data="learn_encryption")],
            [InlineKeyboardButton("❌ Skip for Now", callback_data="cancel_setup")]
        ]

        await TaskManager.send_message(
            update,
            encryption_guide,
            reply_markup=InlineKeyboardMarkup(keyboard)
        )
        return ConversationHandler.END

    @staticmethod
    async def show_timezone_selection(update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Show timezone selection with clear one-time setup message"""
        timezone_text = (
            "🌍 ONE-TIME TIMEZONE SETUP 🌍\n\n"
            "📌 Important:** This is a one-time setup**!\n"
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
                row.append(InlineKeyboardButton(timezones[i][0], callback_data=f"tz_{timezones[i][1]}"))
            if i + 1 < len(timezones):
                row.append(InlineKeyboardButton(timezones[i + 1][0], callback_data=f"tz_{timezones[i + 1][1]}"))
            keyboard.append(row)

        keyboard.append([InlineKeyboardButton("🔍 Search More Timezones", callback_data="search_timezones")])
        keyboard.append([InlineKeyboardButton("❌ Cancel", callback_data="cancel_task")])

        await TaskManager.send_message(
            update,
            timezone_text,
            reply_markup=InlineKeyboardMarkup(keyboard)
        )
        return TASK_DESCRIPTION

    @staticmethod
    async def show_generic_error(update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Show generic error message"""
        await TaskManager.send_message(
            update,
            "❌ Setup Error\n\n"
            "There was an issue with your account setup.\n\n"
            "Please try using /start to complete your setup,\n"
            "or contact support if the issue persists."
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
                    [InlineKeyboardButton("🚀 Use /start", callback_data="guide_start")],
                ])
            )

        elif action == "learn_encryption":
            await TaskManager.edit_message(
                update,
                "🔐 How End-to-End Encryption Works\n\n"
                "✨ **YOUR SECURITY:**\n"
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
                    [InlineKeyboardButton("🔐 Use /start", callback_data="guide_setup_password")]
                ])
            )

        elif action == "cancel_setup":
            await TaskManager.edit_message(
                update,
                "👋 No problem!\n\n"
                "Whenever you're ready to start creating encrypted tasks, just use:\n\n"
                "• `/start` - Begin setup\n\n"
                "Your encrypted task manager will be waiting! ✨\n\n"
                "Have questions? Feel free to ask!"
            )

    @staticmethod
    def detect_time_format_issues(text: str) -> Optional[str]:
        """Detect common time format issues and provide guidance"""
        issues = []

        # Check for space after colon
        if re.search(r'\d:\s+\d', text):
            issues.append("❌ Space after colon (e.g., '4: 01pm')\n   ✅ Use: '4:01pm'")

        # Check for semicolon instead of colon
        if re.search(r'\d;\d', text):
            issues.append("❌ Semicolon instead of colon (e.g., '3;30')\n   ✅ Use: '3:30'")

        # Check for missing zeros in minutes
        if re.search(r':\d(?:am|pm|$)(?!\d)', text):
            issues.append("❌ Single digit minutes (e.g., '4:5pm')\n   ✅ Use: '4:05pm'")

        # Check for time without space before day
        if re.search(r'\d(?:am|pm)[a-zA-Z]', text):
            issues.append("❌ Time attached to day (e.g., '2pmtomorrow')\n   ✅ Use: '2pm tomorrow'")

        # Check for date with slashes
        if re.search(r'\d+/\d+', text):
            issues.append("❌ Date with slashes (e.g., '25/12')\n   ✅ Use: 'december 25'")

        # Check for time before day
        if re.search(r'\d(?:am|pm)\s+(tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)', text,
                     re.IGNORECASE):
            issues.append("❌ Time before day (e.g., '2pm tomorrow')\n   ✅ Use: 'tomorrow 2pm'")

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
                        due_date_naive = due_date_naive.replace(year=now_naive.year)
                        if due_date_naive < now_naive:
                            due_date_naive = due_date_naive.replace(year=now_naive.year + 1)

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
                f"🛠️ Time Format Issues Detected\n\n"
                f"{format_issues}\n\n"
                f"🌍 Your timezone: {timezone_str}\n\n"
                "💡 Correct Format Examples:\n"
                "• \"tomorrow 3:00pm\"\n"
                "• \"next friday at 14:30\"\n"
                "• \"december 25 10:00am\"\n"
                "• \"in 2 days at 9:30\"\n"
                "• \"in 5 minutes\"\n"
                "• \"in 1 hour\"\n\n"
                "✨ Please try again with the correct format:"
            )

            keyboard = [
                [InlineKeyboardButton("🔄 Try Again", callback_data="reset_time")],
                [InlineKeyboardButton("⏰ Skip Due Date", callback_data="create_task")],
                [InlineKeyboardButton("🌍 Change Timezone", callback_data="reset_time")],
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
        relative_due_date = TaskManager.parse_relative_time(user_input, user_tz)
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
    async def handle_timezone_selection(update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle timezone selection and save as user's default"""
        query = update.callback_query
        await query.answer()

        if query.data == "search_timezones":
            await TaskManager.edit_message(
                update,
                "🔍 Search Timezones\n\n"
                "Remember: This is a one-time setup!\n"
                "Your timezone will be saved as your default.\n\n"
                "Please visit: https://timezonedb.com/time-zones\n\n"
                "Find your timezone and enter it like:\n"
                "• \"Africa/Lagos\"\n"
                "• \"America/New_York\"\n"
                "• \"Europe/London\"\n\n"
                "You can change it later using /timezone"
            )
            context.user_data['awaiting_timezone'] = True
            return TASK_DESCRIPTION

        elif query.data.startswith("tz_"):
            timezone_str = query.data[3:]  # e.g. "Africa/Lagos"
            telegram_id = str(query.from_user.id)

            # ✅ FIX: Save timezone using the correct function

            success = await save_user_timezone(telegram_id, timezone_str, context)

            if success:
                # Show current time in selected timezone

                try:

                    user_tz = pytz.timezone(timezone_str)

                    current_time = datetime.now(user_tz)

                    time_display = current_time.strftime('%Y-%m-%d %H:%M %Z')

                except Exception:

                    time_display = "invalid timezone"

                await TaskManager.edit_message(update,

                    f"✅ Timezone Successfully Set!\n\n"
                    f"🌍 Your Timezone: {timezone_str}\n"
                    f"🕐 Current Time: {time_display}\n\n"
                    f"💾 Saved as your default timezone!\n"
                    f"🔧 Need to change it later? Use /timezone\n\n"
                    f"📝 Now, enter your task with a due date:\n\n"
                    f"💡 Examples:\n"
                    f"• \"Buy groceries tomorrow at 3pm\"\n"
                    f"• \"Call John in 1 hour\"\n"
                    f"• \"Finish report by next Monday\""

                )

                return TASK_DESCRIPTION
            else:
                await TaskManager.edit_message(update,"❌ Failed to save timezone. Please try again." )

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
                f"✅ Timezone Successfully Set!\n\n"
                f"🌍 Your Timezone: {timezone_input}\n"
                f"🕐 Current Time: {time_display}\n\n"
                f"💾 Saved as your default timezone!\n\n"
                f"📝 Next: Enter your task with a due date\n\n"
                f"💡 Examples:\n"
                f"• \"Buy groceries tomorrow at 3pm\"\n"
                f"• \"Call John in 1 hour\"\n"
                f"• \"Finish report by next Monday\"\n\n"
                f"🔧 Need to change timezone later? Use /timezone"
            )
            return TASK_DESCRIPTION

        except pytz.UnknownTimeZoneError:
            await TaskManager.send_message(
                update,
                "❌ Unknown Timezone\n\n"
                f"\"{timezone_input}\" is not a valid timezone.\n\n"
                "📌 Remember: This is a **one-time setup!\n\n"
                "💡 **Try these formats:**\n"
                "• \"Africa/Lagos\"\n"
                "• \"America/New_York\"\n"
                "• \"Europe/London\"\n\n"
                "✨ Or select from popular timezones above"
            )
            return await TaskManager.show_timezone_selection(update, context)

    @staticmethod
    async def show_time_parsing_error(update: Update, context: ContextTypes.DEFAULT_TYPE, user_input: str, error: str):
        """Show helpful error message for time parsing issues"""
        error_guide = (
            f"❌ Time Parsing Error\n\n"
            f"Your input: `{user_input}`\n"
            f"**Error: {error}\n\n"
            "🛠️ **Common Fixes:**\n"
            "• Use clear time formats: \"3:30pm\" not \"3;30\"\n"
            "• Specify AM/PM: \"2pm\" not \"2\"\n"
            "• Use words for months: \"december 25\" not \"25/12\"\n"
            "• Put time after day: \"tomorrow 2pm\" not \"2pm tomorrow\"\n"
            "• No space after colon: \"4:01pm\" not \"4: 01pm\"\n\n"
            "💡 Working Examples:\n"
            "• \"tomorrow 3:00pm\"\n"
            "• \"next friday at 14:30\"\n"
            "• \"december 25 10:00am\"\n"
            "• \"in 2 days at 9:30\"\n"
            "• \"in 5 minutes\"\n"
            "• \"in 1 hour\"\n\n"
            "✨ Try again with a clearer format:"
        )

        keyboard = [
            [InlineKeyboardButton("🔄 Try Again", callback_data="reset_time")],
            [InlineKeyboardButton("⏰ Skip Due Date", callback_data="create_task")],
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
            f"📋 Task Review\n\n"
            f"📝 Description:\n"
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
                    f"⏰ Due Date:\n"
                    f"{due_date_local.strftime('%Y-%m-%d %H:%M')}\n"
                    f"⚠️ This time has already passed!\n\n"
                )

                keyboard = [
                    [InlineKeyboardButton("✅ Create Task Anyway", callback_data="create_task")],
                    [InlineKeyboardButton("❌ Cancel Task", callback_data="cancel_task")]
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
                    f"⏰ Due Date:\n"
                    f"{due_date_local.strftime('%Y-%m-%d %H:%M')}\n"
                    f"{time_indicator}\n\n"
                )

                keyboard = [
                    [InlineKeyboardButton("✅ Create Task", callback_data="create_task")],
                    [InlineKeyboardButton("❌ Cancel", callback_data="cancel_task")]
                ]
        else:
            task_card += "⏰ No due date set\n\n"
            keyboard = [
                [InlineKeyboardButton("✅ Create Task", callback_data="create_task")],
                [InlineKeyboardButton("❌ Cancel", callback_data="cancel_task")]
            ]

        task_card += "✨ Choose an option below:"

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

        elif action == "cancel_task":
            await TaskManager.edit_message(update, "❌ Task creation cancelled.")
            context.user_data.clear()
            return ConversationHandler.END

    @staticmethod
    async def finalize_task_creation(update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Finalize task creation + ENFORCE 5 TASKS PER DAY + BULLETPROOF COUNTER"""
        telegram_id = str(update.effective_user.id)
        task_data = context.user_data['current_task']

        try:
            session = await load_user_session(telegram_id, context)
            if not session or not session.get('profile_id'):
                await TaskManager.send_message(update, "Profile not found.\n\nPlease use /start first.")
                return ConversationHandler.END

            profile_id = session['profile_id']
            public_pem = session.get('public_pem')
            if not public_pem:
                await TaskManager.send_message(update,
                                               "Encryption keys not found.\n\nPlease use /start to set up encryption.")
                return ConversationHandler.END

            public_key_bytes = public_pem.encode('utf-8')

            task_details = {
                'task_name': task_data['name'],
                'description': task_data['raw_input'],
                'created_by': telegram_id,
                'created_at': datetime.now(pytz.UTC).isoformat(),
                'due_date': task_data['due_date'].isoformat() if task_data['due_date'] else None,
                'priority': 'normal',
                'status': 'pending',
            }

            encrypted_blob_id = walrus.store_encrypted_user_data(public_key_bytes, task_details)
            if not encrypted_blob_id:
                await TaskManager.send_message(update, "Failed to encrypt task data.\n\nTry again.")
                return ConversationHandler.END

            due_timestamp = int(task_data['due_date'].timestamp() * 1000) if task_data['due_date'] else 0
            task_id = sui.create_task(profile_id, encrypted_blob_id, due_timestamp)

            if not task_id:
                await TaskManager.send_message(update, "Failed to create task on blockchain.\n\nTry again.")
                return ConversationHandler.END

            # SAVE TASK LOCALLY
            from encrypted_db import save_task_locally
            save_task_locally(
                telegram_id=telegram_id,
                task_id=task_id,
                task_name=task_data['name'],
                encrypted_blob_id=encrypted_blob_id,
                due_timestamp=due_timestamp
            )

            # SUCCESS MESSAGE
            success_message = await TaskManager.create_success_card(task_data, task_id, encrypted_blob_id, context)
            user_timezone = await load_user_timezone(telegram_id, context)
            timezone_reminder = f"\n\nYour timezone: {user_timezone}\nChange with /timezone"

            if task_data['due_date']:
                await TaskManager.setup_reminders(context, telegram_id, task_id, task_data)

            context.user_data.clear()
            await TaskManager.send_message(update, success_message + timezone_reminder)

            return ConversationHandler.END

        except Exception as e:
            await TaskManager.send_message(update, f"Failed to create task:\n\n`{str(e)}`", parse_mode='Markdown')
            return ConversationHandler.END

    @staticmethod
    async def create_success_card(task_data: Dict, task_id: str, encrypted_blob_id: str,
                                  context: ContextTypes.DEFAULT_TYPE) -> str:
        """Create beautiful success message"""
        card = (
            f"🎉 Task Created Successfully!\n\n"
            f"📝 Task: {task_data['name']}\n\n"
        )

        if task_data['due_date']:
            # Convert to user's timezone for display
            try:
                user_timezone = await load_user_timezone(task_data.get('created_by', ''), context)
                user_tz = pytz.timezone(user_timezone)
                due_date_local = task_data['due_date'].astimezone(user_tz)
                card += f"⏰ Due: {due_date_local.strftime('%Y-%m-%d %H:%M')}\n\n"
            except:
                card += f"⏰ Due: {task_data['due_date'].strftime('%Y-%m-%d %H:%M')}\n\n"

        card += f"🔐 Encrypted: ✅ Secure\n\n"
        card += f"💾 Storage:** Walrus Network\n\n"
        card += "💡 Use /task_history to view and manage your tasks"

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
                except Exception:
                    pass
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
                        'user_id': int(user_id),
                        'task_id': task_id,
                        'task_name': task_data['name'],
                        'due_date': due_date.isoformat()
                    },
                    name=f"reminder_{task_id}"
                )

        except Exception:
            pass

    @staticmethod
    async def send_reminder_callback(context: ContextTypes.DEFAULT_TYPE):
        """Send reminder callback - FIXED VERSION"""
        try:
            job = context.job
            data = job.data

            # Parse the due_date back from string
            due_date = datetime.fromisoformat(data['due_date']).replace(tzinfo=pytz.UTC)

            reminder_text = (
                f"🔔 Task Reminder!\n\n"
                f"📝 {data['task_name']}\n"
                f"⏰ Due: {due_date.strftime('%Y-%m-%d %H:%M UTC')}\n\n"
                f"💡 Time to complete your task and earn points!\n"
                f"Use: /task_history to view and complete your tasks"
            )

            await context.bot.send_message(
                chat_id=data['user_id'],
                text=reminder_text
            )

        except Exception:
            pass

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
        cleaned_words = [word for word in words if word.lower() not in date_words]
        return ' '.join(cleaned_words) if cleaned_words else text


    @staticmethod
    async def task_history_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Show user's tasks with modern, user-friendly interface using HTML"""
        telegram_id = str(update.effective_user.id)

        # Check user setup first
        is_ready, session, missing_step = await TaskManager.check_user_setup(telegram_id, context)
        if not is_ready:
            # ... existing setup checks ...
            return

        user_timezone = await load_user_timezone(telegram_id, context) or "UTC"
        tz = pytz.timezone(user_timezone)

        tasks = get_user_tasks(telegram_id)
        if not tasks:
            await TaskManager.send_message(
                update,
                "📝 You have no tasks yet!\n\n"
                "Create your first encrypted task with /new_task"
            )
            return

        # Separate pending and completed tasks
        pending_tasks = [t for t in tasks if t['status'] != 'completed']
        completed_tasks = [t for t in tasks if t['status'] == 'completed']

        if not pending_tasks:
            message = "<b>🎉 All Tasks Completed!</b>\n\n"
            message += "You have no pending tasks. Great job! 🚀\n\n"
            reply_markup = InlineKeyboardMarkup([
                [InlineKeyboardButton("📝 Create New Task", callback_data="create_new_task")],
                [InlineKeyboardButton("📊 View Completed", callback_data="show_completed")]
            ])
        else:
            message = "<b>📋 Your Active Tasks</b>\n\n"

            for i, task in enumerate(pending_tasks, 1):
                # Format due date
                due_str = "No due date"
                if task['due_timestamp']:
                    dt = datetime.fromtimestamp(task['due_timestamp'] / 1000, tz=pytz.UTC)
                    local = dt.astimezone(tz)
                    due_str = local.strftime("%b %d • %I:%M %p")

                message += f"<b>{i}. {html.escape(task['task_name'])}</b>\n"
                message += f"   ⏰ {due_str}\n\n"

            # Add completion buttons
            keyboard = []
            for task in pending_tasks:
                short_name = task['task_name'][:20] + "..." if len(task['task_name']) > 20 else task['task_name']
                keyboard.append([
                    InlineKeyboardButton(
                        f"✅ Complete: {short_name}",
                        callback_data=f"complete_{task['task_id']}"
                    )
                ])

            # Add navigation
            if completed_tasks:
                keyboard.append([InlineKeyboardButton("📊 View Completed Tasks", callback_data="show_completed")])

            keyboard.append([InlineKeyboardButton("🔄 Refresh", callback_data="refresh_tasks")])
            keyboard.append([InlineKeyboardButton("📝 New Task", callback_data="create_new_task")])

            reply_markup = InlineKeyboardMarkup(keyboard)

        # Add statistics section
        try:
            from encrypted_db import get_daily_task_count
            current_count = get_daily_task_count(telegram_id)
            remaining = max(0, DAILY_TASK_LIMIT - current_count)
        except Exception:
            current_count, remaining = 0, DAILY_TASK_LIMIT

        can_earn_points, last_time, next_available = await TaskManager.can_earn_task_points_today(telegram_id, context)

        message += f"\n<b>📊 Today's Stats</b>\n"
        message += f"• Tasks created: {current_count}/{DAILY_TASK_LIMIT}\n"
        message += f"• Points available: {'✅ Yes' if can_earn_points else '❌ No'}\n"
        message += f"• Active tasks: {len(pending_tasks)}\n"
        message += f"• Completed: {len(completed_tasks)}\n"
        message += f"• Timezone: {user_timezone}\n\n"

        message += "<b>💡 Tips:</b>\n"
        message += "• Click the buttons to complete tasks\n"
        message += "• Use /new_task to create more tasks"

        # Send the message using the updated send_message method
        await TaskManager.send_message(
            update,
            message,
            reply_markup=reply_markup,
            parse_mode='HTML'
        )

    @staticmethod
    async def handle_task_completion_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle task completion from inline buttons using HTML"""
        query = update.callback_query
        await query.answer()

        telegram_id = str(query.from_user.id)
        callback_data = query.data

        if callback_data == "create_new_task":
            await TaskManager.edit_message(
                update,
                "🚀 <b>Create New Task</b>\n\n"
                "Use /new_task to create your next encrypted task!",
                parse_mode='HTML'
            )
            return

        elif callback_data == "show_completed":
            # Show completed tasks
            tasks = get_user_tasks(telegram_id)
            completed_tasks = [t for t in tasks if t['status'] == 'completed']

            if not completed_tasks:
                await TaskManager.edit_message(
                    update,
                    "<b>📝 Completed Tasks</b>\n\n"
                    "You haven't completed any tasks yet.\n\n"
                    "Complete your first task to see it here! ✨",
                    parse_mode='HTML'
                )
                return

            message = "<b>✅ Completed Tasks</b>\n\n"
            for i, task in enumerate(completed_tasks[-10:], 1):  # Show last 10
                message += f"{i}. {html.escape(task['task_name'])}\n"

            if len(completed_tasks) > 10:
                message += f"\n... and {len(completed_tasks) - 10} more tasks completed!"

            message += "\n\n💡 Keep up the great work! 🚀"

            await TaskManager.edit_message(
                update,
                message,
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton("📋 Back to Active Tasks", callback_data="refresh_tasks")],
                    [InlineKeyboardButton("📝 Create New Task", callback_data="create_new_task")]
                ]),
                parse_mode='HTML'
            )
            return

        elif callback_data == "refresh_tasks":
            # Simply re-display the task list without complex logic
            try:
                await TaskManager.edit_message(update, "🔄 Refreshing your tasks...")

                # Call the task history command directly
                from telegram import Update as TelegramUpdate
                from telegram import Message

                # Create a proper update object for the task_history_command
                if hasattr(update, 'callback_query') and update.callback_query:
                    # Use the existing message to create context
                    message = update.callback_query.message

                    # Create a simple message update
                    class SimpleUpdate:
                        def __init__(self, effective_user, effective_message):
                            self.effective_user = effective_user
                            self.effective_message = effective_message
                            self.message = effective_message

                    simple_update = SimpleUpdate(
                        effective_user=update.callback_query.from_user,
                        effective_message=message
                    )

                    await TaskManager.task_history_command(simple_update, context)
                else:
                    await TaskManager.task_history_command(update, context)

            except Exception:
                await TaskManager.edit_message(
                    update,
                    "<b>❌ Error Refreshing</b>\n\n"
                    "Please use /task_history to view your tasks.",
                    parse_mode='HTML'
                )
            return

        elif callback_data.startswith("complete_"):
            task_id = callback_data[len("complete_"):]

            # Show confirmation dialog
            tasks = get_user_tasks(telegram_id)
            task = next((t for t in tasks if t['task_id'] == task_id), None)
            if not task:
                await TaskManager.edit_message(
                    update,
                    "❌ Task not found\n\n"
                    "This task may have been already completed or deleted.",
                    parse_mode='HTML'
                )
                return

            await TaskManager.edit_message(
                update,
                f"<b>✅ Complete Task?</b>\n\n"
                f"<b>Task:</b> {html.escape(task['task_name'])}\n\n"
                f"Are you sure you want to mark this task as completed?",
                reply_markup=InlineKeyboardMarkup([
                    [
                        InlineKeyboardButton("✅ Yes, Complete", callback_data=f"confirm_complete_{task_id}"),
                        InlineKeyboardButton("❌ Cancel", callback_data="cancel_completion")
                    ]
                ]),
                parse_mode='HTML'
            )
            return

        elif callback_data.startswith("confirm_complete_"):
            task_id = callback_data[len("confirm_complete_"):]

            # Complete the task using your existing completion logic
            success = update_task_status(telegram_id, task_id, "completed")

            if success:
                # Check if user can earn points today
                can_earn_points, last_time, next_available = await TaskManager.can_earn_task_points_today(telegram_id,
                                                                                                          context)

                # Award points if eligible
                if can_earn_points:
                    points_awarded = await TaskManager.award_task_points(telegram_id, context)
                    if points_awarded:
                        message = (
                            f"<b>🎉 Task Completed!</b>\n\n"
                            f"<b>⭐ +{DAILY_POINTS_LIMIT} points earned!</b>\n\n"
                            f"💡 Complete more tasks to stay productive!"
                        )
                    else:
                        message = "<b>✅ Task Completed!</b>\n\nGreat job staying organized! 🚀"
                else:
                    message = (
                        f"<b>✅ Task Completed!</b>\n\n"
                        f"💡 <b>Daily points limit reached</b>\n"
                        f"You can still complete more tasks for organization!"
                    )

                await TaskManager.edit_message(
                    update,
                    message,
                    reply_markup=InlineKeyboardMarkup([
                        [InlineKeyboardButton("📋 View Tasks", callback_data="refresh_tasks")],
                        [InlineKeyboardButton("📝 Create New Task", callback_data="create_new_task")]
                    ]),
                    parse_mode='HTML'
                )
            else:
                await TaskManager.edit_message(
                    update,
                    "<b>❌ Failed to complete task</b>\n\n"
                    "Please try again or contact support if the issue persists.",
                    parse_mode='HTML'
                )
            return

        elif callback_data == "cancel_completion":
            await TaskManager.edit_message(
                update,
                "<b>❌ Completion cancelled</b>\n\n"
                "Task remains active in your list.",
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton("📋 Back to Tasks", callback_data="refresh_tasks")]
                ]),
                parse_mode='HTML'
            )
            return

        else:
            # Handle unknown callback
            await query.answer("Unknown action")
            return

    @staticmethod
    async def complete_dynamic_task(update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handles /complete_abc123xyz789 commands with session checking"""
        telegram_id = str(update.effective_user.id)

        # Check user setup first
        is_ready, session, missing_step = await TaskManager.check_user_setup(telegram_id, context)
        if not is_ready:
            if missing_step == "profile":
                await update.message.reply_text("❌ Profile not found. Please use /start first.")
                return
            elif missing_step == "encryption":
                await update.message.reply_text("❌ Encryption not set up. Please use /start first.")
                return
            elif missing_step == "timezone":
                await update.message.reply_text("❌ Timezone not set. Please use /new_task first.")
                return

        command = update.effective_message.text.strip()
        suffix = command.split("_")[-1]

        tasks = get_user_tasks(telegram_id)
        task = next((t for t in tasks if t['task_id'].endswith(suffix)), None)

        if not task:
            await update.message.reply_text("❌ Task not found or already completed")
            return

        if task['status'] == 'completed':
            await update.message.reply_text("✅ Task already completed")
            return

        # Check if user can earn points today
        can_earn_points, last_time, next_available = await TaskManager.can_earn_task_points_today(telegram_id, context)

        success = update_task_status(telegram_id, task['task_id'], "completed")
        if success:
            # Award points only if eligible
            if can_earn_points:
                points_awarded = await TaskManager.award_task_points(telegram_id, context)
                if points_awarded:
                    await update.message.reply_text(
                        f"🎉 Task completed: {task['task_name']}\n\n"
                        f"⭐ {DAILY_POINTS_LIMIT} points awarded! (Daily limit reached)\n\n"
                        f"💡 You can still complete more tasks today,\n"
                        f"but no additional points will be awarded."
                    )
                else:
                    await update.message.reply_text(f"✅ Task completed: {task['task_name']}")
            else:
                await update.message.reply_text(
                    f"✅ Task completed:** {task['task_name']}\n\n"
                    f"💡 **Daily points limit reached** ({DAILY_POINTS_LIMIT} points max per day)\n"
                    f"You can still complete more tasks for organization!"
                )
        else:
            await update.message.reply_text("❌ Failed to complete task")


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
            "✨ You can always complete tasks later with /task_history"
        )
        return ConversationHandler.END

    if callback_data.startswith('complete_'):
        task_id = callback_data[len('complete_'):]

        try:
            # Check user setup first
            is_ready, session, missing_step = await TaskManager.check_user_setup(telegram_id, context)
            if not is_ready:
                if missing_step == "profile":
                    await TaskManager.edit_message(
                        update,
                        "❌ **Profile Not Found**\n\n"
                        "Please use /start to create your profile first."
                    )
                    return ConversationHandler.END
                elif missing_step == "encryption":
                    await TaskManager.edit_message(
                        update,
                        "❌ **Encryption Not Set Up**\n\n"
                        "Please use /start to set up your encryption keys."
                    )
                    return ConversationHandler.END
                elif missing_step == "timezone":
                    await TaskManager.edit_message(
                        update,
                        "❌ Timezone Not Set\n\n"
                        "Please use /new_task to set your timezone first."
                    )
                    return ConversationHandler.END

            profile_id = session.get('profile_id')

            # Complete task on blockchain
            success = sui.complete_task(task_id, profile_id)

            if success:
                # Check if user can earn points today
                can_earn_points, last_time, next_available = await TaskManager.can_earn_task_points_today(telegram_id,
                                                                                                          context)

                # Try to get task name for confirmation
                task_name = "your task"
                try:
                    user_password = session.get('password') or context.user_data.get('password')
                    if user_password:
                        private_key = await get_user_private_key(telegram_id, user_password)
                        if private_key:
                            task_details = sui.get_task_details(task_id)
                            if task_details:
                                encrypted_blob = task_details.get('encrypted_details_blob')
                                if encrypted_blob:
                                    decrypted_task = walrus.retrieve_encrypted_task(encrypted_blob, private_key)
                                    if decrypted_task:
                                        task_name = decrypted_task.get('task_name', task_name)
                except Exception:
                    # Continue even if decryption fails
                    pass

                # Award points only if eligible
                if can_earn_points:
                    points_awarded = await TaskManager.award_task_points(telegram_id, context)
                    if points_awarded:
                        completion_message = (
                            f"🎉 **Task Completed!**\n\n"
                            f"✅ {task_name}\n\n"
                            f"⭐ **+{DAILY_POINTS_LIMIT} points earned!** (Daily limit reached)\n"
                            f"🔐 Securely recorded on blockchain\n\n"
                            f"💡 You can still complete more tasks today,\n"
                            f"but no additional points will be awarded."
                        )
                    else:
                        completion_message = f"✅ **Task Completed!**\n\n{task_name}"
                else:
                    # Send completion message without points
                    completion_message = (
                        f"✅ **Task Completed!**\n\n"
                        f"📝 {task_name}\n\n"
                        f"💡 **Daily points limit reached** ({DAILY_POINTS_LIMIT} points max per day)\n"
                        f"You can still complete more tasks for organization!"
                    )

                await TaskManager.edit_message(update, completion_message)

            else:
                await TaskManager.edit_message(
                    update,
                    "❌ **Error Completing Task**\n\n"
                    "Could not mark the task as completed.\n\n"
                    "**Possible reasons:**\n"
                    "• Task doesn't exist\n"
                    "• Task already completed\n"
                    "• Blockchain error\n\n"
                    "✨ Please try again or check with /task_history"
                )

            return ConversationHandler.END
        except Exception:
            await TaskManager.edit_message(
                update,
                "❌ **Error Completing Task**\n\n"
                "An unexpected error occurred.\n\n"
                "✨ Please try again later or contact support."
            )
            return ConversationHandler.END


async def timezone_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Command to view and change user's timezone"""
    # Check if this is a manual timezone input
    if update.message and context.user_data.get('awaiting_timezone_change'):
        return await handle_manual_timezone_input(update, context)

    telegram_id = str(update.effective_user.id)

    try:
        current_timezone = await load_user_timezone(telegram_id, context) or "UTC"

        # Get current time in user's timezone
        try:
            user_tz = pytz.timezone(current_timezone)
            current_time = datetime.now(user_tz)
            time_display = current_time.strftime('%Y-%m-%d %H:%M %Z')
        except:
            time_display = "unknown time"
            current_timezone = "UTC"  # Fallback to UTC

        message = (
            f"🌍 **Your Timezone Settings**\n\n"
            f"**Current Timezone:** `{current_timezone}`\n"
            f"**Current Time:** {time_display}\n\n"
            f"💡 **Select a new timezone below:**"
        )

        # Timezone selection keyboard - improved with better grouping
        timezones = [
            ("🇳🇬 Lagos (WAT)", "Africa/Lagos"),
            ("🇬🇧 London (GMT)", "Europe/London"),
            ("🇪🇺 Paris (CET)", "Europe/Paris"),
            ("🇺🇸 New York (EST)", "America/New_York"),
            ("🇺🇸 Chicago (CST)", "America/Chicago"),
            ("🇺🇸 Los Angeles (PST)", "America/Los_Angeles"),
            ("🇸🇬 Singapore (SGT)", "Asia/Singapore"),
            ("🇮🇳 Mumbai (IST)", "Asia/Kolkata"),
            ("🇯🇵 Tokyo (JST)", "Asia/Tokyo"),
            ("🇦🇺 Sydney (AEST)", "Australia/Sydney"),
            ("🇨🇳 Shanghai (CST)", "Asia/Shanghai"),
        ]

        keyboard = []
        for i in range(0, len(timezones), 2):
            row = []
            if i < len(timezones):
                row.append(InlineKeyboardButton(timezones[i][0], callback_data=f"change_tz_{timezones[i][1]}"))
            if i + 1 < len(timezones):
                row.append(InlineKeyboardButton(timezones[i + 1][0], callback_data=f"change_tz_{timezones[i + 1][1]}"))
            keyboard.append(row)

        keyboard.append([InlineKeyboardButton("🔍 Search More Timezones", callback_data="change_tz_search")])
        keyboard.append([InlineKeyboardButton("❌ Cancel", callback_data="change_tz_cancel")])

        await update.message.reply_text(
            message,
            reply_markup=InlineKeyboardMarkup(keyboard),
            parse_mode='Markdown'
        )

    except Exception:
        await update.message.reply_text(
            "❌ **Error loading timezone settings**\n\n"
            "Please try again later."
        )

async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Modern cancel handler for both command and conversation"""
    await TaskManager.send_message(
        update,
        "❌ **Operation Cancelled**\n\n"
        "The current operation has been cancelled.\n\n"
        "✨ **What would you like to do next?**\n"
        "• /new_task - Create a new task\n"
        "• /task_history - View your tasks\n"
        "• /profile - Check your profile\n"
        "• /portfolio - Check your wallet"
    )
    context.user_data.clear()
    return ConversationHandler.END

async def handle_timezone_change(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle timezone change callback queries"""
    query = update.callback_query
    await query.answer()

    telegram_id = str(query.from_user.id)
    action = query.data

    if action == "change_tz_cancel":
        await TaskManager.edit_message(
            update,
            "❌ Timezone change cancelled.\n\n"
            "Your current timezone remains unchanged."
        )
        return

    elif action == "change_tz_search":
        await TaskManager.edit_message(
            update,
            "🔍 **Search Timezones**\n\n"
            "Please visit: https://timezonedb.com/time-zones\n\n"
            "Find your timezone and enter it like:\n"
            "• `Africa/Lagos`\n"
            "• `America/New_York`\n"
            "• `Europe/London`\n\n"
            "Then type it below:"
        )
        context.user_data['awaiting_timezone_change'] = True
        return

    elif action.startswith("change_tz_"):
        timezone_str = action[10:]  # Remove "change_tz_" prefix

        try:
            # Validate timezone
            user_tz = pytz.timezone(timezone_str)

            # Save timezone
            success = await save_user_timezone(telegram_id, timezone_str, context)

            if success:
                # Show current time in new timezone
                current_time = datetime.now(user_tz)
                time_display = current_time.strftime('%Y-%m-%d %H:%M %Z')

                await TaskManager.edit_message(
                    update,
                    f"✅ **Timezone Updated Successfully!**\n\n"
                    f"🌍 **New Timezone:** {timezone_str}\n"
                    f"🕐 **Current Time:** {time_display}\n\n"
                    f"All your future tasks will use this timezone.\n\n"
                    f"💡 Need to change again? Use `/timezone`"
                )
            else:
                await TaskManager.edit_message(
                    update,
                    "❌ **Failed to save timezone**\n\n"
                    "Please try again or contact support."
                )

        except pytz.UnknownTimeZoneError:
            await TaskManager.edit_message(
                update,
                f"❌ **Invalid Timezone**\n\n"
                f"`{timezone_str}` is not a valid timezone.\n\n"
                "Please select from the list below:"
            )
            # Show timezone selection again
            await timezone_command(update, context)
        except Exception:
            await TaskManager.edit_message(
                update,
                "❌ **Error changing timezone**\n\n"
                "Please try again later."
            )


async def handle_manual_timezone_input(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle manual timezone input from user"""
    telegram_id = str(update.effective_user.id)
    timezone_input = update.message.text.strip()

    # Clear the flag
    context.user_data.pop('awaiting_timezone_change', None)

    try:
        # Validate timezone
        user_tz = pytz.timezone(timezone_input)

        # Save timezone
        success = await save_user_timezone(telegram_id, timezone_input, context)

        if success:
            # Show current time in new timezone
            current_time = datetime.now(user_tz)
            time_display = current_time.strftime('%Y-%m-%d %H:%M %Z')

            await update.message.reply_text(
                f"✅ **Timezone Updated Successfully!**\n\n"
                f"🌍 **New Timezone:** `{timezone_input}`\n"
                f"🕐 **Current Time:** {time_display}\n\n"
                f"All your future tasks will use this timezone.\n\n"
                f"💡 Need to change again? Use `/timezone`",
                parse_mode='Markdown'
            )
        else:
            await update.message.reply_text(
                "❌ **Failed to save timezone**\n\n"
                "Please try again or contact support."
            )

    except pytz.UnknownTimeZoneError:
        await update.message.reply_text(
            f"❌ **Invalid Timezone**\n\n"
            f"`{timezone_input}` is not a valid timezone.\n\n"
            "Please check the spelling and try again, or use the buttons below:",
            parse_mode='Markdown'
        )
        # Show timezone selection again
        await timezone_command(update, context)
    except Exception:
        await update.message.reply_text(
            "❌ **Error changing timezone**\n\n"
            "Please try again later."
        )

# Create conversation handlers
task_conv_handler = ConversationHandler(
    entry_points=[
        CommandHandler('new_task', TaskManager.create_modern_task_ui),
    ],
    states={
        TASK_DESCRIPTION: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, TaskManager.handle_task_input),
            CallbackQueryHandler(TaskManager.handle_timezone_selection, pattern='^tz_.*|^search_timezones$'),
            CallbackQueryHandler(TaskManager.handle_task_review_actions, pattern='^reset_time$'),
            CallbackQueryHandler(TaskManager.handle_task_review_actions, pattern='^cancel_task$')
        ],
        TASK_REVIEW: [
            CallbackQueryHandler(
                TaskManager.handle_task_review_actions,
                pattern='^(create_task|reset_time|keep_past_date|add_email|cancel_task)$'
            )
        ],
    },
    fallbacks=[CommandHandler('cancel', cancel)],
    allow_reentry=True
)

setup_callback_handler = CallbackQueryHandler(
    TaskManager.handle_setup_callbacks,
    pattern='^(guide_start|guide_setup_password|learn_features|learn_encryption|cancel_setup)$'
)


task_completion_handler = CallbackQueryHandler(
    TaskManager.handle_task_completion_callback,
    pattern="^(complete_.*|confirm_complete_.*|create_new_task|show_completed|refresh_tasks|cancel_completion)$"
)


timezone_callback_handler = CallbackQueryHandler(
    handle_timezone_change,
    pattern='^change_tz_.*|^change_tz_search$|^change_tz_cancel$'
)