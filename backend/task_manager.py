from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CommandHandler, MessageHandler, CallbackQueryHandler, ConversationHandler, filters
import logging
from supabase import create_client
from datetime import datetime
from apscheduler.schedulers.asyncio import AsyncIOScheduler
import os
from parsedatetime import Calendar
import smtplib
from email.mime.text import MIMEText
from dotenv import load_dotenv
import time
import pytz

# Load environment variables
load_dotenv()
LOG_DIR = os.path.join("/tmp", "logs")
os.makedirs(LOG_DIR, exist_ok=True)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(os.path.join(LOG_DIR, "copilot.log")),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Supabase client
supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_KEY")
if not supabase_url or not supabase_key:
    raise ValueError("SUPABASE_URL and SUPABASE_KEY must be set in the environment or .env file")
supabase = create_client(supabase_url, supabase_key)

# Environment variables for email
EMAIL_USER = os.getenv("EMAIL_USER")
EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD")
if not EMAIL_USER or not EMAIL_PASSWORD:
    raise ValueError("EMAIL_USER and EMAIL_PASSWORD must be set in the environment or .env file")

# Conversation states
TASK_DESCRIPTION, TASK_INPUT, EMAIL_INPUT, WALLET_INPUT, TIMEZONE_INPUT = range(5)

# Function to send confirmation email
async def send_confirmation_email(email, task_name, task_id, due_date, wallet):
    subject = f"New Task: {task_name}"
    due_date_str = f"Due: {due_date.strftime('%Y-%m-%d %H:%M')}" if due_date else "No due date"
    # HTML formatted email body
    body = f"""
    <html>
        <body style="font-family: Arial, sans-serif; color: #333;">
            <h2 style="color: #2c3e50;">New Task Confirmation</h2>
            <p>Hi!</p>
            <p>Your task <strong>{task_name}</strong> (ID: <strong>{task_id}</strong>) has been created!</p>
            <p><span style="color: #e74c3c;">{due_date_str}</span></p>
            <p>Your email <strong>{email}</strong> and wallet <strong>{wallet}</strong> are set up.</p>
            <p style="color: #27ae60;">Best,<br>Your Copilot Bot</p>
        </body>
    </html>
    """
    msg = MIMEText(body, 'html')
    msg['Subject'] = subject
    msg['From'] = EMAIL_USER
    msg['To'] = email
    try:
        with smtplib.SMTP('smtp.gmail.com', 587, timeout=10) as server:
            server.starttls()
            server.login(EMAIL_USER, EMAIL_PASSWORD)
            server.send_message(msg)
        logger.info(f"Email sent to {email}")
        return True
    except smtplib.SMTPAuthenticationError as e:
        logger.error(f"Email authentication failed for {email}: {e}")
        return False
    except smtplib.SMTPException as e:
        logger.error(f"SMTP error for {email}: {e}")
        return False
    except Exception as e:
        logger.error(f"Unexpected error sending email to {email}: {e}")
        return False

# Function to send task reminder (Telegram + Email)
async def send_reminder(context: ContextTypes.DEFAULT_TYPE, chat_id, task_name, due_date, user_id):
    # Send Telegram message
    await context.bot.send_message(
        chat_id=chat_id,
        text=f"Reminder! ⏰ Your task '{task_name}' is due at {due_date.strftime('%Y-%m-%d %H:%M')} (your local time)."
    )
    logger.info(f"Reminder sent for task '{task_name}' to chat_id {chat_id}")

    # Fetch user email from Supabase
    user_response = supabase.table('users').select('email').eq('user_id', user_id).execute()
    if user_response.data and len(user_response.data) > 0:
        email = user_response.data[0].get('email')
        if email:
            subject = f"Task Reminder: {task_name}"
            # HTML formatted email body
            body = f"""
            <html>
                <body style="font-family: Arial, sans-serif; color: #333;">
                    <h2 style="color: #2c3e50;">Task Reminder</h2>
                    <p>Hi!</p>
                    <p>This is a reminder that your task <strong>{task_name}</strong> is due!</p>
                    <p><span style="color: #e74c3c;">Due: {due_date.strftime('%Y-%m-%d %H:%M')} (your local time)</span></p>
                    <p style="color: #27ae60;">Best,<br>Your Copilot Bot</p>
                </body>
            </html>
            """
            msg = MIMEText(body, 'html')
            msg['Subject'] = subject
            msg['From'] = EMAIL_USER
            msg['To'] = email
            try:
                with smtplib.SMTP('smtp.gmail.com', 587, timeout=10) as server:
                    server.starttls()
                    server.login(EMAIL_USER, EMAIL_PASSWORD)
                    server.send_message(msg)
                logger.info(f"Email reminder sent to {email} for task '{task_name}'")
            except Exception as e:
                logger.error(f"Failed to send email reminder to {email}: {e}")

async def new_task_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    logger.info("Received /new_task command")
    await update.message.reply_text(
        "Welcome to Task Creation! 🎉\nPlease enter your task. Examples:\n- Buy ETH\n- Remind me to buy ETH by 3pm\nType your task or /cancel to exit."
    )
    return TASK_DESCRIPTION

async def handle_task_description(update: Update, context: ContextTypes.DEFAULT_TYPE):
    task_input = update.message.text.strip()
    logger.info(f"Received task description: {task_input}, user={update.effective_user.id}")
    cal = Calendar()
    time_struct, parse_status = cal.parse(task_input)
    due_date = datetime(*time_struct[:6]) if parse_status else None
    task_name = task_input if parse_status else task_input  # Keep full task_input if due date is parsed

    user_id = str(update.effective_user.id)
    try:
        logger.info("Checking if user profile exists")
        profile_response = supabase.table('user_profiles').select('user_id', 'timezone').eq('user_id', user_id).execute()
        if not profile_response.data or len(profile_response.data) == 0:
            logger.info(f"Creating default profile for user {user_id}")
            supabase.table('user_profiles').insert({
                'user_id': user_id,
                'is_premium': False,
                'created_at': datetime.now().isoformat()
            }).execute()

        logger.info("Starting transaction for task creation")
        response = supabase.rpc('create_task_with_history', {
            'user_id': user_id,
            'task_name': task_name,
            'due_date': due_date.isoformat() if due_date else None,
            'created_at': datetime.now().isoformat()
        }).execute()
        task_data = response.data
        if not task_data or not task_data[0].get('task_id'):
            logger.error(f"Failed to create task: {response}")
            await update.message.reply_text(
                "Error! ❌ Failed to create task. Please try again or check Supabase setup."
            )
            return ConversationHandler.END
        task_id = task_data[0]['task_id']
        logger.info(f"Task '{task_name}' created for user {user_id} (id={task_id})")

        context.user_data['task_id'] = task_id
        context.user_data['task_name'] = task_name
        context.user_data['due_date'] = due_date

        # Check if user is premium and has email/wallet
        user_response = supabase.table('users').select('is_premium, email, wallet').eq('user_id', user_id).execute()
        is_premium = False
        user_email = None
        user_wallet = None
        if user_response.data and len(user_response.data) > 0:
            user_data = user_response.data[0]
            is_premium = user_data.get('is_premium', False)
            user_email = user_data.get('email')
            user_wallet = user_data.get('wallet')
        logger.info(f"User {user_id} premium status: {is_premium}, email: {user_email}, wallet: {user_wallet}")

        if is_premium:
            if user_email and user_wallet:
                # Check if timezone is set in user profile
                profile_data = profile_response.data[0] if profile_response.data else {}
                user_timezone = profile_data.get('timezone')
                if user_timezone:
                    try:
                        timezone = pytz.timezone(user_timezone)
                        if await send_confirmation_email(user_email, task_name, task_id, due_date, user_wallet):
                            chat_id = update.effective_chat.id
                            if due_date:
                                local_due_date = timezone.localize(due_date)
                                scheduler = context.job_queue.scheduler
                                scheduler.add_job(
                                    send_reminder,
                                    'date',
                                    run_date=local_due_date,
                                    args=[context, chat_id, task_name, local_due_date, user_id]
                                )
                                logger.info(f"Reminder scheduled for task '{task_name}' at {local_due_date} in {user_timezone}")
                            await update.message.reply_text(
                                f"Task Created! 🎉\nTask: {task_name}\nDue: {due_date.strftime('%Y-%m-%d %H:%M') if due_date else 'No due date'}\nConfirmation sent to {user_email}. Check your inbox! 📬\nReminder set for your local time! ⏰"
                            )
                            context.user_data.clear()
                            return ConversationHandler.END
                    except pytz.exceptions.UnknownTimeZoneError:
                        logger.warning(f"Invalid timezone {user_timezone} for user {user_id}, prompting for timezone")
                # If no timezone or invalid, prompt for timezone
                await update.message.reply_text(
                    f"Task Created! 🎉\nTask: {task_name}\nDue: {due_date.strftime('%Y-%m-%d %H:%M') if due_date else 'No due date'}\nPlease enter your time zone (e.g., 'Africa/Lagos', 'America/New_York'). See https://www.iana.org/time-zones for a list."
                )
                context.user_data['email'] = user_email
                context.user_data['wallet'] = user_wallet
                return TIMEZONE_INPUT
            # User is premium but missing email or wallet, show buttons
            keyboard = [
                [InlineKeyboardButton("Yes, provide details", callback_data='provide_details'),
                 InlineKeyboardButton("Skip", callback_data='skip')]
            ]
            reply_markup = InlineKeyboardMarkup(keyboard)
            due_date_str = f"Due: {due_date.strftime('%Y-%m-%d %H:%M')}" if due_date else "No due date"
            await update.message.reply_text(
                f"Task Created! 🎉\nTask: {task_name}\n{due_date_str}\nPlease provide your email and wallet details or skip:",
                reply_markup=reply_markup
            )
            return TASK_INPUT
        else:
            # Non-premium user, show subscribe option
            keyboard = [
                [InlineKeyboardButton("Subscribe", url="https://copilot.com"),
                 InlineKeyboardButton("Skip", callback_data='skip')]
            ]
            reply_markup = InlineKeyboardMarkup(keyboard)
            due_date_str = f"Due: {due_date.strftime('%Y-%m-%d %H:%M')}" if due_date else "No due date"
            await update.message.reply_text(
                f"Task Created! 🎉\nTask: {task_name}\n{due_date_str}\nChoose an option:",
                reply_markup=reply_markup
            )
            return TASK_INPUT

    except Exception as e:
        logger.error(f"Supabase error in handle_task_description: {str(e)}", exc_info=True)
        await update.message.reply_text(
            f"Error! ❌ Failed to create task: {str(e)}. Please check Supabase setup."
        )
        return ConversationHandler.END

async def button_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    logger.info(f"Button clicked: data={query.data}, user={query.from_user.id}")
    if query.data == 'provide_details':
        await query.message.reply_text(
            "Please enter your email address. 📧"
        )
        await query.message.delete()
        return EMAIL_INPUT
    elif query.data == 'skip':
        await query.message.reply_text(
            "You chose to skip. Task created without email or wallet details. ✅"
        )
        await query.message.delete()
        context.user_data.clear()
        return ConversationHandler.END

async def handle_email_input(update: Update, context: ContextTypes.DEFAULT_TYPE):
    email = update.message.text.strip()
    logger.info(f"Received email: {email}, user={update.effective_user.id}")
    if '@' not in email or '.' not in email:
        await update.message.reply_text(
            "Invalid email format! ❌ Please try again or use /cancel."
        )
        return EMAIL_INPUT
    context.user_data['email'] = email
    await update.message.reply_text(
        f"Email received! 📧 Now please enter your wallet address (e.g., 0x...). Note: You specified a Sui wallet, but the code expects an Ethereum address. Please provide a valid Ethereum address (e.g., 0x123...)."
    )
    return WALLET_INPUT

async def handle_wallet_input(update: Update, context: ContextTypes.DEFAULT_TYPE):
    wallet = update.message.text.strip()
    logger.info(f"Received wallet: {wallet}, user={update.effective_user.id}")
    if not (wallet.startswith('0x') and len(wallet) == 42 and all(c in '0123456789abcdefABCDEF' for c in wallet[2:])):
        await update.message.reply_text(
            "Invalid wallet address! ❌ Please enter a valid Ethereum address (e.g., 0x123...). Try again or use /cancel."
        )
        return WALLET_INPUT
    context.user_data['wallet'] = wallet
    await update.message.reply_text(
        "Wallet received! 💰 Please enter your time zone (e.g., 'Africa/Lagos', 'America/New_York'). See https://www.iana.org/time-zones for a list."
    )
    return TIMEZONE_INPUT

async def handle_timezone_input(update: Update, context: ContextTypes.DEFAULT_TYPE):
    timezone_str = update.message.text.strip()
    logger.info(f"Received timezone: {timezone_str}, user={update.effective_user.id}")
    try:
        timezone = pytz.timezone(timezone_str)
        context.user_data['timezone'] = timezone_str
        user_id = str(update.effective_user.id)
        supabase.table('user_profiles').upsert({
            'user_id': user_id,
            'timezone': timezone_str
        }, on_conflict='user_id').execute()
        logger.info(f"Timezone {timezone_str} saved for user {user_id}")
    except pytz.exceptions.UnknownTimeZoneError:
        await update.message.reply_text(
            "Invalid time zone! ❌ Please enter a valid time zone (e.g., 'Africa/Lagos'). Try again or use /cancel."
        )
        return TIMEZONE_INPUT

    user_id = str(update.effective_user.id)
    scheduler = context.job_queue.scheduler

    try:
        supabase.table('users').upsert({
            'user_id': user_id,
            'email': context.user_data['email'],
            'wallet': context.user_data['wallet'],
            'is_premium': True
        }, on_conflict='user_id').execute()
        logger.info(f"User data saved to Supabase for user {user_id}")
        if await send_confirmation_email(
            context.user_data['email'],
            context.user_data['task_name'],
            context.user_data['task_id'],
            context.user_data['due_date'],
            context.user_data['wallet']
        ):
            chat_id = update.effective_chat.id
            due_date = context.user_data['due_date']
            if due_date:
                user_timezone = pytz.timezone(context.user_data['timezone'])
                local_due_date = user_timezone.localize(due_date)
                scheduler.add_job(
                    send_reminder,
                    'date',
                    run_date=local_due_date,
                    args=[context, chat_id, context.user_data['task_name'], local_due_date, user_id]
                )
                logger.info(f"Reminder scheduled for task '{context.user_data['task_name']}' at {local_due_date} in {timezone_str}")
            await update.message.reply_text(
                f"Task and details set up! ✅\nConfirmation sent to {context.user_data['email']}.\nCheck your inbox! 📬\nReminder set for your local time! ⏰"
            )
            time.sleep(1)
        else:
            await update.message.reply_text(
                f"Task and details set up! ✅\nHowever, confirmation email failed. ⚠️ Please check your email settings or contact support."
            )
    except Exception as e:
        logger.error(f"Supabase error in handle_timezone_input: {str(e)}", exc_info=True)
        await update.message.reply_text(
            f"Error! ❌ Failed to save task details: {str(e)}. Please try again."
        )

    context.user_data.clear()
    return ConversationHandler.END

async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    logger.info(f"Cancel command received, user={update.effective_user.id}")
    await update.message.reply_text("Cancelled. ❌")
    context.user_data.clear()
    return ConversationHandler.END

# Export the conversation handler
task_conv_handler = ConversationHandler(
    entry_points=[CommandHandler('new_task', new_task_command)],
    states={
        TASK_DESCRIPTION: [MessageHandler(filters.TEXT & ~filters.COMMAND, handle_task_description)],
        TASK_INPUT: [
            CallbackQueryHandler(button_callback, pattern='^provide_details$|^skip$')
        ],
        EMAIL_INPUT: [MessageHandler(filters.TEXT & ~filters.COMMAND, handle_email_input)],
        WALLET_INPUT: [MessageHandler(filters.TEXT & ~filters.COMMAND, handle_wallet_input)],
        TIMEZONE_INPUT: [MessageHandler(filters.TEXT & ~filters.COMMAND, handle_timezone_input)]
    },
    fallbacks=[CommandHandler('cancel', cancel)]
)