"""
Copilot Telegram Bot - Blockchain-Backed Task Management with End-to-End Encryption
===================================================================================
"""
import asyncio
import json
from pathlib import Path
from uuid import uuid4
import telegram.error
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ContextTypes, CommandHandler, MessageHandler,
    CallbackQueryHandler, ConversationHandler, filters, Application
)
from datetime import datetime
import logging
import os
import re
import pytz
from parsedatetime import Calendar
from dotenv import load_dotenv
from typing import Dict, Optional, Any
from app.telegram_bot.checkin import checkin_handler, checkin_status_handler, check_my_profile_handler
from app.telegram_bot.leaderboard import leaderboard_handler, refresh_leaderboard_button_handler
from app.telegram_bot.task_manager import task_conv_handler, setup_callback_handler, timezone_command, complete_task_command, my_tasks_command, TaskManager
from app.telegram_bot.portfolio_command import portfolio_handler
# Import all utilities from utils.py
from app.telegram_bot.waitlist import WaitlistManager
from app.telegram_bot.utils import (
    is_strong_password, is_valid_email, is_valid_telegram_id,
    is_valid_referral_code, is_valid_admin_code, is_admin,
    save_user_session_to_blockchain, load_user_session, clear_user_session,
    parse_natural_language_date, format_date_for_display,
    format_profile_data, format_task_data, ensure_user_has_keys,
    create_user_keys, get_user_private_key, handle_error,
    RegistrationError, EncryptionError, BlockchainError,
    get_walrus_client, get_key_manager, get_sui_client, user_sessions, load_user_timezone, save_user_session
)

load_dotenv()

LOG_DIR = os.path.join("/tmp", "logs")
os.makedirs(LOG_DIR, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(os.path.join(LOG_DIR, "copilot_bot.log")),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

walrus = get_walrus_client()
key_manager = get_key_manager()
sui = get_sui_client()

# Conversation states
TASK_DESCRIPTION, TASK_INPUT, EMAIL_INPUT, WALLET_INPUT, TIMEZONE_INPUT = range(
    5)
SELECT_TASK, CONFIRM_DELETE, SET_PASSWORD, CONFIRM_PASSWORD = range(5, 9)
SELECT_METHOD, REFERRAL_CODE_INPUT, ADMIN_CODE_INPUT, EMAIL_VERIFICATION = range(
    9, 13)

# Admin user IDs (set in .env)
ADMIN_IDS = set(os.getenv('ADMIN_TELEGRAM_IDS', '').split(','))

# ============= REGISTRATION SYSTEM INTEGRATION =============


class TelegramRegistrationSystem:
    """Registration system adapted for Telegram bot."""

    def __init__(self):
        self.sui_client = sui
        self.walrus_client = walrus
        self.key_manager = key_manager

    async def display_welcome(self, update: Update):
        """Display welcome message."""
        welcome_msg = (
            "🤖 Welcome to Tovira Bot! 🚀\n\n"
            "🔐 PRIVACY-First ARCHITECTURE\n\n"
            "This bot provides:\n"
            "• End-to-end encrypted task management\n"
            "• Blockchain-backed data storage\n"
            "• Secure referral system\n"
            "• Premium features\n\n"
            "Your data is encrypted before storage - only YOU can decrypt it!"
        )
        await update.message.reply_text(welcome_msg)

    async def collect_user_info(self, telegram_id: str, username: str, registration_method: int = 1) -> Dict[str, Any]:
        """Collect user information for Telegram registration."""
        method_map = {1: 'direct', 2: 'admin', 3: 'referral'}
        return {
            'username': username,
            'telegram_id': telegram_id,
            'user_uuid': str(uuid4()),
            'created_at': datetime.now().isoformat(),
            'registration_source': 'telegram_bot',
            'registration_method': method_map.get(registration_method, 'direct'),
            'preferences': {
                'theme': 'dark',
                'notifications': True,
                'language': 'en'
            }
        }

    async def create_user_password(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle password creation in Telegram."""
        try:
            progress_msg = await update.effective_message.reply_text(
                "🔐 Password Setup\n\n"
                "Create a strong password for encryption:\n"
                "• At least 8 characters\n"
                "• Uppercase and lowercase letters\n"
                "• At least one number\n\n"
                "⚠️ IMPORTANT: This password cannot be recovered!\n"
                "Enter your password:"
            )
            # Store progress_msg for deletion in the next state
            context.user_data['password_prompt_msg'] = progress_msg
            logger.info(
                f"Sent password prompt message {progress_msg.message_id} for user {update.effective_user.id}")
            return SET_PASSWORD
        except Exception as e:
            logger.error(
                f"Error sending password prompt for user {update.effective_user.id}: {e}")
            await update.effective_message.reply_text("⚠️ Error setting up password. Please try again.")
            return ConversationHandler.END

    async def generate_keys(self, telegram_id: str, password: str, context: ContextTypes.DEFAULT_TYPE) -> bool:
        """Generate encryption keys for user."""
        progress_msg = None
        try:
            progress_msg = await context.bot.send_message(
                chat_id=telegram_id,
                text="🔑 Generating encryption keys..."
            )
            await context.bot.send_chat_action(chat_id=telegram_id, action='typing')
            public_key_str, encrypted_private = self.key_manager.create_user_keys(
                telegram_id, password)
            context.user_data['public_key'] = public_key_str.encode('utf-8')
            context.user_data['has_encryption_keys'] = True
            logger.info(f"Created encryption keys for {telegram_id}")
            await self.safe_delete_message(progress_msg, delay=2)
            return True
        except Exception as e:
            logger.error(f"Error creating keys for {telegram_id}: {e}")
            if progress_msg:
                await progress_msg.edit_text("⚠️ Failed to generate encryption keys.")
                await self.safe_delete_message(progress_msg, delay=3)
            return False

    async def encrypt_and_upload_data(self, user_data: Dict[str, Any], public_key: bytes, update: Update) -> Optional[
            str]:
        """Encrypt user data and upload to Walrus."""
        progress_msg = None
        try:
            progress_msg = await update.effective_chat.send_message("🔐 Encrypting your data...")
            blob_id = self.walrus_client.store_encrypted_user_data(
                public_key, user_data)
            if blob_id:
                await progress_msg.edit_text("✅ Data encrypted and stored securely!")
                await self.safe_delete_message(progress_msg, delay=2)
                return blob_id
            else:
                await progress_msg.edit_text("❌ Failed to store encrypted data.")
                await self.safe_delete_message(progress_msg, delay=3)
                return None
        except Exception as e:
            logger.error(f"Error encrypting/uploading data: {e}")
            if progress_msg:
                await progress_msg.edit_text("❌ Error encrypting data.")
                await self.safe_delete_message(progress_msg, delay=3)
            return None

    async def select_registration_method(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Show registration button and proceed directly to password setup."""
        keyboard = [
            [InlineKeyboardButton("🆕 Signup with TOVIRA",
                                  callback_data='signup_no_code')],
        ]
        reply_markup = InlineKeyboardMarkup(keyboard)

        await update.message.reply_text(
            "⛓️ Register with Tovira\n\n"
            "Click the button below to start registration:",
            reply_markup=reply_markup
        )
        return SELECT_METHOD

    async def register_on_blockchain(self, blob_id: str, registration_method: int,
                                     context: ContextTypes.DEFAULT_TYPE, update: Update) -> Optional[Dict[str, str]]:
        progress_msg = None
        try:
            progress_msg = await update.effective_chat.send_message("⛓️ Creating blockchain profile...")
            if registration_method == 1:  # No referral
                result = self.sui_client.create_user_profile(blob_id)
                logger.info(
                    f"create_user_profile result for blob_id {blob_id}: {result}")
            elif registration_method == 2:  # Admin code
                admin_code = context.user_data.get('admin_code')
                result = self.sui_client.create_user_profile_with_admin_code(
                    admin_code, blob_id)
                logger.info(
                    f"create_user_profile_with_admin_code result for admin_code {admin_code}, blob_id {blob_id}: {result}")
            elif registration_method == 3:  # User referral
                referral_code = context.user_data.get('referral_code')
                result = self.sui_client.create_user_profile_with_referral(
                    referral_code, blob_id)
                logger.info(
                    f"create_user_profile_with_referral result for referral_code {referral_code}, blob_id {blob_id}: {result}")
            else:
                logger.error(
                    f"Invalid registration_method: {registration_method}")
                await progress_msg.edit_text("❌ Invalid registration method.")
                await self.safe_delete_message(progress_msg, delay=3)
                return None

            if not result or not isinstance(result, dict):
                logger.error(
                    f"Invalid blockchain result for blob_id {blob_id}: {result}")
                await progress_msg.edit_text(
                    "⚠️ Blockchain profile creation failed. Proceeding without profile ID.")
                await self.safe_delete_message(progress_msg, delay=3)
                return None

            if not result.get('profile_id'):
                logger.warning(
                    f"No profile_id in result for blob_id {blob_id}: {result}")
                await progress_msg.edit_text(
                    "⚠️ Profile ID not created. Registration will proceed without it.")
                await self.safe_delete_message(progress_msg, delay=3)

            # Success: Delete progress message (no delay, as result is returned)
            await self.safe_delete_message(progress_msg)
            return result

        except Exception as e:
            logger.error(
                f"Error registering on blockchain for blob_id {blob_id}: {e}", exc_info=True)
            if progress_msg:
                await progress_msg.edit_text(
                    "⚠️ Blockchain profile creation failed. Proceeding without profile ID.")
                await self.safe_delete_message(progress_msg, delay=3)
            return None

    async def save_registration_receipt(self, user_data: Dict[str, Any],
                                        registration_result: Dict[str, str],
                                        blob_id: str) -> str:
        """Save registration receipt for records."""
        receipt = {
            'username': user_data['username'],
            'telegram_id': user_data['telegram_id'],
            'profile_id': registration_result['profile_id'],
            'tx_digest': registration_result['tx_digest'],
            'walrus_blob_id': blob_id,
            'registered_at': datetime.now().isoformat(),
            'registration_method': registration_result.get('admin_code_used') or
            registration_result.get('referrer_code') or
            'direct'
        }
        receipts_dir = Path('./registration_receipts')
        receipts_dir.mkdir(exist_ok=True)
        filename = f"{user_data['telegram_id']}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        receipt_path = receipts_dir / filename
        with open(receipt_path, 'w') as f:
            json.dump(receipt, f, indent=2)
        return str(receipt_path)

    async def display_success(self, registration_result: Dict[str, str],
                              blob_id: str, receipt_path: str,
                              context: ContextTypes.DEFAULT_TYPE, update: Update):
        """Display success message with blockchain profile."""
        profile_id = registration_result.get('profile_id')
        user_data = context.user_data.get('user_data', {})
        details = self.sui_client.get_user_details(
            profile_id) if profile_id else {}
        my_referral_code = details.get(
            'referral_code', 'N/A') if details else 'N/A'
        success_msg = (
            f"🎉 Registration Complete!\n\n"
            f"📋 Your Details:\n"
            f"• Username: {user_data.get('username', 'N/A')}\n"
            f"• Telegram ID: {user_data.get('telegram_id', 'N/A')}\n"
            f"• Profile ID: {profile_id[:16] + '...' if profile_id else 'Not created'}\n"
            # f"• Referral Code: {my_referral_code}\n"
            # f"• Encrypted Data: {blob_id[:16]}...\n"
            f"• Created At: {user_data.get('created_at', 'N/A')}\n"
            f"• Preferences: {user_data.get('preferences', {})}\n\n"
        )
        if 'admin_code_used' in registration_result:
            success_msg += f"🔑 Admin Code: {registration_result['admin_code_used']}\n\n"
        elif 'referrer_code' in registration_result:
            success_msg += f"🎁 Referral Used: {registration_result['referrer_code']}\n\n"
        success_msg += (
            f"🔐 Security:\n"
            f"• End-to-end encryption active\n"
            f"• Private key secured with your password\n"
            f"• Data stored on decentralized storage\n\n"
            f"Use /help to see all commands!"
        )
        await update.effective_chat.send_message(success_msg)
        logger.info(
            f"Registration successful for {context.user_data.get('telegram_id')}")

    async def display_success_minimal(self, blob_id: str, receipt_path: str,
                                      context: ContextTypes.DEFAULT_TYPE, update: Update):
        """Display success message for registration without profile_id."""
        user_data = context.user_data.get('user_data', {})
        success_msg = (
            f"🎉 Registration Complete (Local Mode)!\n\n"
            f"📋 Your Details:\n"
            f"• Username: {user_data.get('username', 'N/A')}\n"
            f"• Telegram ID: {user_data.get('telegram_id', 'N/A')}\n"
            f"• Encrypted Data: {blob_id[:16]}...\n"
            f"• Created At: {user_data.get('created_at', 'N/A')}\n"
            f"• Preferences: {user_data.get('preferences', {})}\n\n"
            f"🔐 Security:\n"
            f"• End-to-end encryption active\n"
            f"• Private key secured with your password\n"
            f"• Data stored on decentralized storage\n\n"
            f"Use /help to see all commands!"
        )
        await update.effective_chat.send_message(success_msg)
        logger.info(
            f"Local registration successful for {context.user_data.get('telegram_id')}")

    async def safe_delete_message(self, message, delay: float = 0):
        """Safely delete a message with optional delay, handling common errors."""
        if not message:
            return
        try:
            if delay > 0:
                await asyncio.sleep(delay)
            await message.delete()
            logger.info(
                f"Deleted message {message.message_id} in chat {message.chat.id}")
        except telegram.error.BadRequest as e:
            logger.warning(
                f"Failed to delete message {message.message_id}: {e}")
        except telegram.error.Forbidden as e:
            logger.error(
                f"Forbidden to delete message {message.message_id}: {e}")
        except Exception as e:
            logger.error(
                f"Unexpected error deleting message {message.message_id}: {e}")

    async def verify_registration(self, telegram_id: str, password: str, blob_id: str, update: Update) -> bool:
        """Verify registration by attempting to decrypt data."""
        progress_msg = None
        try:
            progress_msg = await update.effective_chat.send_message("🔍 Verifying encryption...")
            private_key = self.key_manager.get_user_private_key(
                telegram_id, password)
            if not private_key:
                await progress_msg.edit_text("❌ Verification failed - no private key")
                await self.safe_delete_message(progress_msg, delay=2)
                return False

            decrypted_data = self.walrus_client.retrieve_encrypted_user_data(
                blob_id, private_key)
            if decrypted_data:
                await progress_msg.edit_text("✅ Verification successful! Your data is secure.")
                await self.safe_delete_message(progress_msg, delay=2)
                return True

            await progress_msg.edit_text("❌ Verification failed - could not decrypt data")
            await self.safe_delete_message(progress_msg, delay=2)
            return False

        except Exception as e:
            logger.error(f"Verification error for {telegram_id}: {e}")
            if progress_msg:
                await progress_msg.edit_text("⚠️ Verification skipped due to error.")
                await self.safe_delete_message(progress_msg, delay=2)
            return False

    async def run_registration(self, telegram_id: str, username: str, password: str,
                               context: ContextTypes.DEFAULT_TYPE, update: Update,
                               registration_method: int = 1, **kwargs) -> bool:
        progress_msg = None
        try:
            user_data = await self.collect_user_info(telegram_id, username, registration_method)
            progress_msg = await update.effective_chat.send_message("🔄 Starting registration...")

            # Generate keys
            await progress_msg.edit_text("🔑 Generating encryption keys...")
            if not await self.generate_keys(telegram_id, password, context):
                await progress_msg.edit_text("❌ Failed to generate encryption keys.")
                await self.safe_delete_message(progress_msg, delay=3)
                return False

            # Get public key
            await progress_msg.edit_text("🔑 Retrieving public key...")
            public_key = self.key_manager.get_user_public_key(telegram_id)
            if not public_key:
                await progress_msg.edit_text("❌ Failed to retrieve public key.")
                await self.safe_delete_message(progress_msg, delay=3)
                return False

            # Encrypt and upload
            await progress_msg.edit_text("🔐 Encrypting and uploading data...")
            blob_id = await self.encrypt_and_upload_data(user_data, public_key, update)
            if not blob_id:
                await progress_msg.edit_text("❌ Failed to encrypt and upload data.")
                await self.safe_delete_message(progress_msg, delay=3)
                return False

            logger.info(
                f"Attempting blockchain registration for {telegram_id} with blob_id: {blob_id}")

            # Blockchain registration
            await progress_msg.edit_text("⛓️ Creating blockchain profile...")
            registration_result = await self.register_on_blockchain(
                blob_id, registration_method, context, update
            )

            profile_id = registration_result.get('profile_id') if registration_result and isinstance(
                registration_result, dict) else None

            # Prepare receipt
            receipt = {
                'username': user_data['username'],
                'telegram_id': telegram_id,
                'walrus_blob_id': blob_id,
                'registered_at': datetime.now().isoformat(),
                'registration_method': 'direct' if registration_method == 1 else 'admin' if registration_method == 2 else 'referral',
                'status': 'blockchain' if profile_id else 'local_only',
                'user_data': user_data,
                'profile_id': profile_id
            }
            if registration_result and 'admin_code_used' in registration_result:
                receipt['admin_code_used'] = registration_result['admin_code_used']
            elif registration_result and 'referrer_code' in registration_result:
                receipt['referrer_code'] = registration_result['referrer_code']

            receipts_dir = Path('./registration_receipts')
            receipts_dir.mkdir(exist_ok=True)
            filename = f"{telegram_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            receipt_path = receipts_dir / filename
            with open(receipt_path, 'w') as f:
                json.dump(receipt, f, indent=2)

            context.user_data.update({
                'encrypted_data_blob': blob_id,
                'password': password,
                'user_data': user_data,
                'profile_id': profile_id
            })

            # Delete progress message
            await self.safe_delete_message(progress_msg)

            # Display success
            if profile_id:
                await self.display_success(registration_result, blob_id, receipt_path, context, update)
            else:
                await self.display_success_minimal(blob_id, receipt_path, context, update)

            verify = True
            if verify:
                await self.verify_registration(telegram_id, password, blob_id, update)

            logger.info(
                f"Registration completed successfully for {telegram_id} {'with profile_id' if profile_id else 'locally'}")
            return True

        except Exception as e:
            logger.error(
                f"Registration failed for {telegram_id}: {e}", exc_info=True)
            if progress_msg:
                await progress_msg.edit_text("❌ Registration failed. Please try /start again.")
                await self.safe_delete_message(progress_msg, delay=5)
            else:
                error_msg = await update.effective_chat.send_message("❌ Registration failed. Please try /start again.")
                await self.safe_delete_message(error_msg, delay=5)
            return False

# ============= START & ONBOARDING =============


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """
    Handle /start - With waitlist verification
    """
    telegram_id = str(update.effective_user.id)
    username = update.effective_user.username or update.effective_user.first_name
    logger.info(f"/start from {telegram_id} (@{username})")

    # Check if user is already registered and has keys
    has_keys = await ensure_user_has_keys(telegram_id, context)
    if has_keys:
        session = await load_user_session(telegram_id, context)
        if session and session.get('profile_id'):
            points = session.get('points', 0)
            is_premium = session.get('is_premium', False)
            premium_badge = " 👑" if is_premium else ""
            welcome_back = (
                f"Welcome back{premium_badge}! 🎉\n\n"
                f"Points: {points} ⭐\n\n"
                f"Commands:\n"
                f"/new_task - Create task\n"
                f"/my_tasks - View tasks\n"
                f"/checkin - Daily check-in\n"
                "/portfolio - Check your sui wallet assets (NFTs, kiosk....)"
            )
            await update.message.reply_text(welcome_back)
            return ConversationHandler.END

    # If not registered, ask for email verification
    await update.message.reply_text(
        "📧 Please enter your email address to verify waitlist access:"
    )
    return EMAIL_VERIFICATION


async def handle_email_verification(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle email input and verify against waitlist."""
    email = update.message.text.strip().lower()

    # Basic email validation
    if '@' not in email or '.' not in email.split('@')[1]:
        await update.message.reply_text("❌ Please enter a valid email address.")
        return EMAIL_VERIFICATION

    await update.message.reply_text("Checking email address...")

    # Query Walrus waitlist
    whitelist_blob_id = os.getenv('WHITELIST_BLOB_ID')
    waitlist_manager = WaitlistManager()

    try:
        if not whitelist_blob_id:
            # Skip verification if no whitelist configured
            await update.message.reply_text("✅ Access granted! Starting registration...")
            return await proceed_to_registration(update, context, email)

        is_whitelisted = waitlist_manager.is_email_whitelisted(
            email, whitelist_blob_id)

        if is_whitelisted:
            await update.message.reply_text("✅ Email verified! Starting registration...")
            return await proceed_to_registration(update, context, email)
        else:
            await update.message.reply_text("❌ Access Denied: Please wait for referral codes to be released.")
            return ConversationHandler.END

    except Exception as e:
        logger.error(f"Waitlist verification error: {e}")
        await update.message.reply_text("❌ Error verifying email. Please try /start again.")
        return ConversationHandler.END


async def proceed_to_registration(update: Update, context: ContextTypes.DEFAULT_TYPE, email: str):
    """Proceed with the normal registration flow."""
    context.user_data['verified_email'] = email

    # Continue with your existing registration flow
    registration_system = TelegramRegistrationSystem()
    await registration_system.display_welcome(update)
    return await registration_system.select_registration_method(update, context)


async def security_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /security command - Display security and encryption info."""
    telegram_id = str(update.effective_user.id)
    if not await ensure_user_has_keys(telegram_id, context):
        await update.message.reply_text(
            "No encryption keys found.\n"
            "Use /start to set up encryption."
        )
        return
    session = await load_user_session(telegram_id, context)
    encrypted_blob = (
        session.get('encrypted_data_blob') or
        context.user_data.get('encrypted_data_blob') or
        (session.get('profile_data', {})).get('encrypted_data_blob') or
        'Not set'
    )
    if encrypted_blob == 'Not set' and (profile_id := session.get('profile_id') or context.user_data.get('profile_id')):
        profile_data = sui.get_user_profile(profile_id)
        if profile_data:
            encrypted_blob = profile_data.get('encrypted_data_blob', 'Not set')
            if encrypted_blob != 'Not set':
                session['encrypted_data_blob'] = encrypted_blob
                context.user_data['encrypted_data_blob'] = encrypted_blob
    security_info = (
        f"Security & Encryption\n\n"
        f"ENCRYPTION:\n"
        f"- Algorithm: RSA-4096 + AES-256-GCM\n"
        f"- Key Type: Asymmetric (public/private)\n"
        f"- Your encrypted blob: {encrypted_blob[:16]}...\n\n"
        f"STORAGE:\n"
        f"- Sui blockchain: Profile state, encrypted blob reference\n"
        f"- Walrus network: Encrypted data (only you can decrypt)\n"
        f"- Your device: Encrypted private key\n\n"
        f"PRIVACY:\n"
        f"- Zero-knowledge architecture\n"
        f"- Only YOU have the decryption key\n"
        f"- Admins cannot read your data\n"
        f"- End-to-end encryption\n\n"
        f"Keep your password safe - it cannot be recovered!"
    )
    await update.message.reply_text(security_info)


async def handle_signup_choice(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle signup method selection."""
    query = update.callback_query
    await query.answer()
    choice = query.data
    logger.info(f"Signup choice: {choice}, user_data: {context.user_data}")
    registration_system = TelegramRegistrationSystem()
    if choice == 'signup_no_code':
        context.user_data['signup_method'] = 'no_code'
        await query.edit_message_text("🆕 No referral code selected. Let's set up your password...")
        return await registration_system.create_user_password(update, context)
    elif choice == 'signup_user_code':
        context.user_data['signup_method'] = 'user_code'
        await query.edit_message_text(
            "🎁 Enter your friend's referral code (8 characters):"
        )
        return REFERRAL_CODE_INPUT
    elif choice == 'signup_admin_code':
        context.user_data['signup_method'] = 'admin_code'
        await query.edit_message_text(
            "🔑 Enter your admin code (ADM-XXXX-XXXX):"
        )
        return ADMIN_CODE_INPUT


async def handle_user_referral_input(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle user referral code input and validation."""
    telegram_id = str(update.effective_user.id)
    code = update.message.text.strip().upper()
    if not is_valid_referral_code(code):
        await update.message.reply_text(
            "❌ Invalid code format.\n"
            "User codes are 8 characters (e.g., ABC123XY)\n\n"
            "Try again or /cancel:"
        )
        return REFERRAL_CODE_INPUT
    try:
        referrer_addr = sui.get_user_by_referral_code(code)
        if not referrer_addr:
            await update.message.reply_text(
                f"❌ Code '{code}' not found.\n\n"
                f"Check the code and try again or /cancel:"
            )
            return REFERRAL_CODE_INPUT
        usage_info = sui.get_user_referral_code_usage(code)
        if not usage_info.get('is_available', False):
            remaining = usage_info.get('remaining_uses', 0)
            await update.message.reply_text(
                f"❌ Code '{code}' has no uses remaining.\n\n"
                f"Used: {usage_info.get('usage_count', 0)}/{usage_info.get('max_uses', 0)}\n\n"
                f"Ask your friend for a new code or /cancel:"
            )
            return REFERRAL_CODE_INPUT
        context.user_data['referral_code'] = code
        context.user_data['referrer_address'] = referrer_addr
        remaining = usage_info.get('remaining_uses', 0)
        await update.message.reply_text(
            f"✅ Valid code!\n\n"
            f"Code: {code}\n"
            f"Remaining uses: {remaining}\n\n"
            f"Now let's set up your encryption.\n\n"
            f"Create a strong password:\n"
            f"• At least 8 characters\n"
            f"• Uppercase and lowercase\n"
            f"• At least one number\n\n"
            f"Enter password:"
        )
        registration_system = TelegramRegistrationSystem()
        return await registration_system.create_user_password(update, context)
    except Exception as e:
        logger.error(f"Error checking referral code: {e}")
        await update.message.reply_text(
            "❌ Error validating code. Try again or /cancel:"
        )
        return REFERRAL_CODE_INPUT


async def handle_admin_code_input(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle admin code input and validation."""
    telegram_id = str(update.effective_user.id)
    code = update.message.text.strip().upper()
    if not is_valid_admin_code(code):
        await update.message.reply_text(
            "❌ Invalid admin code format.\n"
            "Admin codes look like: ADM-XXXX-XXXX\n\n"
            "Try again or /cancel:"
        )
        return ADMIN_CODE_INPUT
    try:
        is_available = sui.is_admin_code_available(code)
        if not is_available:
            status = sui.get_admin_code_status(code)
            if not status.get('exists', False):
                await update.message.reply_text(
                    f"❌ Code '{code}' doesn't exist.\n\n"
                    f"Check the code and try again or /cancel:"
                )
            else:
                await update.message.reply_text(
                    f"❌ Code '{code}' has already been claimed.\n\n"
                    f"Contact admin for a new code or /cancel:"
                )
            return ADMIN_CODE_INPUT
        context.user_data['admin_code'] = code
        await update.message.reply_text(
            f"✅ Valid admin code!\n\n"
            f"Code: {code}\n\n"
            f"Now let's set up your encryption.\n\n"
            f"Create a strong password:\n"
            f"• At least 8 characters\n"
            f"• Uppercase and lowercase\n"
            f"• At least one number\n\n"
            f"Enter password:"
        )
        registration_system = TelegramRegistrationSystem()
        return await registration_system.create_user_password(update, context)
    except Exception as e:
        logger.error(f"Error checking admin code: {e}")
        await update.message.reply_text(
            "❌ Error validating code. Try again or /cancel:"
        )
        return ADMIN_CODE_INPUT


async def handle_password_setup(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle password input."""
    telegram_id = str(update.effective_user.id)
    password = update.message.text.strip()

    # Delete the user's password input
    try:
        await update.message.delete()
        logger.info(
            f"Deleted user password input message for user {telegram_id}")
    except Exception as e:
        logger.warning(
            f"Failed to delete user password input for user {telegram_id}: {e}")

    is_valid, error_msg = is_strong_password(password)
    if not is_valid:
        error_msg_sent = await update.effective_chat.send_message(
            f"❌ {error_msg}\n\nTry again:"
        )
        await safe_delete_message(error_msg_sent, delay=3)
        return SET_PASSWORD

    context.user_data['temp_password'] = password
    success_msg = await update.effective_chat.send_message(
        "✅ Password accepted!\n\nConfirm password:"
    )
    context.user_data['password_success_msg'] = success_msg
    logger.info(
        f"Sent password success message {success_msg.message_id} for user {telegram_id}")
    return CONFIRM_PASSWORD


async def safe_delete_message(message, delay: float = 0):
    """Safely delete a message with optional delay, handling common errors."""
    if not message:
        return
    try:
        if delay > 0:
            await asyncio.sleep(delay)
        await message.delete()
        logger.info(
            f"Deleted message {message.message_id} in chat {message.chat.id}")
    except telegram.error.BadRequest as e:
        logger.warning(f"Failed to delete message {message.message_id}: {e}")
    except telegram.error.Forbidden as e:
        logger.error(f"Forbidden to delete message {message.message_id}: {e}")
    except Exception as e:
        logger.error(
            f"Unexpected error deleting message {message.message_id}: {e}")


async def handle_password_confirmation(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Complete user registration using new registration system."""
    telegram_id = str(update.effective_user.id)
    username = update.effective_user.username or update.effective_user.first_name
    password_confirm = update.message.text.strip()

    # Delete the user's password input
    try:
        await update.message.delete()
        logger.info(
            f"Deleted user password input message for user {telegram_id}")
    except Exception as e:
        logger.warning(
            f"Failed to delete user password input for user {telegram_id}: {e}")

    # Delete the password prompt message
    progress_msg = context.user_data.get('password_prompt_msg')
    if progress_msg:
        await safe_delete_message(progress_msg, delay=0)
        context.user_data.pop('password_prompt_msg', None)
        logger.info(
            f"Deleted password prompt message {progress_msg.message_id} for user {telegram_id}")

    temp_password = context.user_data.get('temp_password')
    if password_confirm != temp_password:
        error_msg = await update.effective_chat.send_message("❌ Passwords don't match! Use /start to try again.")
        await safe_delete_message(error_msg, delay=3)
        context.user_data.pop('temp_password', None)
        context.user_data.pop('signup_method', None)
        return ConversationHandler.END

    signup_method = context.user_data.get('signup_method', 'no_code')
    registration_method = 1
    kwargs = {}
    if signup_method == 'admin_code':
        registration_method = 2
        kwargs['admin_code'] = context.user_data.get('admin_code')
    elif signup_method == 'user_code':
        registration_method = 3
        kwargs['referral_code'] = context.user_data.get('referral_code')

    registration_system = TelegramRegistrationSystem()
    success = await registration_system.run_registration(
        telegram_id=telegram_id,
        username=username,
        password=temp_password,
        context=context,
        update=update,
        registration_method=registration_method,
        **kwargs
    )

    context.user_data.pop('temp_password', None)
    context.user_data.pop('signup_method', None)

    if not success:
        error_msg = await update.effective_chat.send_message("⚠️ Registration failed. Please try /start again.")
        await safe_delete_message(error_msg, delay=3)
        return ConversationHandler.END

    return ConversationHandler.END
# ============= PROFILE & INFO =============
# async def profile_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
#     """Show user profile with referral info."""
#     telegram_id = str(update.effective_user.id)
#     session = await load_user_session(telegram_id, context)
#     if not session or not session.get('profile_id'):
#         await update.message.reply_text("Use /start to create profile.")
#         return
#     profile_id = session.get('profile_id')
#     details = sui.get_user_details(profile_id)
#     if not details:
#         await update.message.reply_text("Error loading profile.")
#         return
#     is_premium = details.get('is_premium', False)
#     points = details.get('points', 0)
#     my_code = details.get('referral_code', '')
#     total_refs = details.get('total_referrals_made', 0)
#     claimed_admin = details.get('claimed_admin_code')
#     usage = sui.get_user_referral_code_usage(my_code)
#     used = usage.get('usage_count', 0)
#     max_uses = usage.get('max_uses', 2)
#     remaining = usage.get('remaining_uses', 0)
#     premium_status = "Premium 👑" if is_premium else "Basic"
#     profile_text = (
#         f"📊 Your Profile\n\n"
#         f"Status: {premium_status}\n"
#         f"Points: {points} ⭐\n\n"
#         f"🎁 REFERRAL INFO:\n"
#         f"Your code: `{my_code}`\n"
#         f"Usage: {used}/{max_uses} (remaining: {remaining})\n"
#         f"Total referrals: {total_refs}\n\n"
#     )
#     if claimed_admin:
#         profile_text += f"🔑 Joined with admin code: {claimed_admin}\n\n"
#     profile_text += (
#         f"Share: https://t.me/YOUR_BOT?start={my_code}\n\n"
#         f"Commands:\n"
#         f"/referral - Referral details\n"
#         f"/upgrade - Go premium"
#     )
#     await update.message.reply_text(profile_text, parse_mode='Markdown')

# async def referral_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
#     """Show detailed referral info."""
#     telegram_id = str(update.effective_user.id)
#     session = await load_user_session(telegram_id, context)
#     profile_id = session.get('profile_id')
#     if not profile_id:
#         await update.message.reply_text("Use /start first.")
#         return
#     details = sui.get_user_details(profile_id)
#     if not details:
#         await update.message.reply_text("Error loading profile.")
#         return
#     is_premium = details.get('is_premium', False)
#     points = details.get('points', 0)
#     my_code = details.get('referral_code', '')
#     total_refs = details.get('total_referrals_made', 0)
#     usage = sui.get_user_referral_code_usage(my_code)
#     used = usage.get('usage_count', 0)
#     max_uses = usage.get('max_uses', 2)
#     remaining = usage.get('remaining_uses', 0)
#     daily_limit = 5 if is_premium else 2
#     points_per_ref = 10 if is_premium else 5
#     referral_msg = (
#         f"🎁 Referral Program\n\n"
#         f"YOUR CODE: `{my_code}`\n\n"
#         f"📊 STATS:\n"
#         f"• Total referrals: {total_refs}\n"
#         f"• Code usage: {used}/{max_uses}\n"
#         f"• Remaining uses: {remaining}\n"
#         f"• Points earned: {points} ⭐\n\n"
#         f"🎯 REWARDS:\n"
#         f"• Points per referral: {points_per_ref}\n"
#         f"• Daily limit: {daily_limit}\n\n"
#     )
#     if remaining == 0:
#         referral_msg += (
#             f"⚠️ Your code has no uses left!\n"
#             f"{'Upgrade to premium for 5 uses!' if not is_premium else 'All uses exhausted.'}\n\n"
#         )
#     referral_msg += (
#         f"SHARE LINK:\n"
#         f"https://t.me/YOUR_BOT?start={my_code}\n\n"
#         f"💡 TIP: Premium users get 5 uses + 10 points per referral!"
#     )
#     await update.message.reply_text(referral_msg, parse_mode='Markdown')
# ============= ADMIN COMMANDS =============


async def admin_generate_codes(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Admin command to generate referral codes."""
    telegram_id = str(update.effective_user.id)
    if not is_admin(telegram_id):
        await update.message.reply_text("❌ Admin only.")
        return
    try:
        await update.message.reply_text(
            "🔑 Generating 10 admin codes...\n"
            "This will take a moment..."
        )
        admin_cap_id = os.getenv('ADMIN_CAP_ID')
        if not admin_cap_id:
            await update.message.reply_text(
                "❌ ADMIN_CAP_ID not set in environment."
            )
            return
        result = sui.admin_generate_code_batch(admin_cap_id)
        if result and result.get('codes'):
            codes = result['codes']
            batch_id = result.get('batch_id', 'N/A')
            codes_text = '\n'.join([f"• `{code}`" for code in codes])
            msg = (
                f"✅ Generated {len(codes)} codes!\n\n"
                f"CODES:\n{codes_text}\n\n"
                f"Batch ID: {batch_id[:16]}...\n\n"
                f"Share these codes with new users.\n"
                f"Each code can only be used once."
            )
            await update.message.reply_text(msg, parse_mode='Markdown')
            logger.info(
                f"Admin {telegram_id} generated code batch: {batch_id}")
        else:
            await update.message.reply_text(
                "❌ Error generating codes."
            )
    except Exception as e:
        logger.error(f"Error generating admin codes: {e}")
        await update.message.reply_text(f"❌ Error: {str(e)}")


async def admin_check_code(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Admin command to check code status."""
    telegram_id = str(update.effective_user.id)
    if not is_admin(telegram_id):
        await update.message.reply_text("❌ Admin only.")
        return
    parts = update.message.text.strip().split()
    if len(parts) < 2:
        await update.message.reply_text(
            "Usage: /check_code <code>\n\n"
            "Example:\n"
            "/check_code ADM-A3F2-B4C1"
        )
        return
    code = parts[1].upper()
    try:
        status = sui.get_admin_code_status(code)
        exists = status.get('exists', False)
        available = status.get('available', False)
        if not exists:
            await update.message.reply_text(
                f"❌ Code '{code}' doesn't exist."
            )
        elif available:
            await update.message.reply_text(
                f"✅ Code '{code}' is available!"
            )
        else:
            await update.message.reply_text(
                f"⚠️ Code '{code}' has been claimed."
            )
    except Exception as e:
        logger.error(f"Error checking code: {e}")
        await update.message.reply_text("Error checking code.")

# ============= REWARDS =============
# async def upgrade_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
#     """Show premium upgrade info."""
#     telegram_id = str(update.effective_user.id)
#     session = await load_user_session(telegram_id, context)
#     if not session.get('profile_id'):
#         await update.message.reply_text("Use /start first.")
#         return
#     is_premium = session.get('is_premium', False)
#     if is_premium:
#         await update.message.reply_text(
#             "👑 You're already premium!\n\n"
#             "Benefits:\n"
#             "• 5 referral uses (vs 2)\n"
#             "• 10 points per referral (vs 5)\n"
#             "• Priority support"
#         )
#         return
#     await update.message.reply_text(
#         "👑 Upgrade to Premium\n\n"
#         "BENEFITS:\n"
#         "• 5 referral uses (vs 2)\n"
#         "• 10 points per referral (vs 5)\n"
#         "• Priority support\n"
#         "• Advanced features\n\n"
#         "💰 Price: 1 SUI\n\n"
#         "To upgrade:\n"
#         "1. Send 1 SUI to Treasury\n"
#         "2. Use /process_upgrade <coin_id>"
#     )
# ============= HELP =============


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show all commands."""
    help_text = (
        "🤖 Tovira Bot Commands\n\n"
        "GETTING STARTED:\n"
        "/start - Create account\n"
        # "/profile - View profile\n"
        # "/referral - Referral info\n\n"
        "TASKS:\n"
        "/new_task - Create task\n"
        # "/my_tasks - View tasks\n"
        # "/complete_task - Mark done\n"
        # "/delete_task - Delete task\n\n"
        "/portfolio - Check your sui wallet assets (NFTs, kiosk....)"
        "REWARDS:\n"
        "/checkin - Daily +1 point\n"
        "/leaderboard - Check you rank and points!"
        # "/upgrade - Go premium\n\n"
        "🔐 End-to-end encrypted"
    )
    telegram_id = str(update.effective_user.id)
    if is_admin(telegram_id):
        help_text += (
            "\n\nADMIN:\n"
            "/generate_codes - Generate 10 codes\n"
            "/check_code <code> - Check status"
        )
    await update.message.reply_text(help_text)


async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Cancel conversation."""
    await update.message.reply_text("❌ Cancelled.")
    context.user_data.clear()
    return ConversationHandler.END
# ============= CONVERSATION HANDLERS =============
signup_handler = ConversationHandler(
    entry_points=[
        CommandHandler("start", start_command)
    ],
    states={
        SELECT_METHOD: [
            CallbackQueryHandler(handle_signup_choice, pattern='^signup_')
        ],
        EMAIL_VERIFICATION: [
            MessageHandler(filters.TEXT & ~filters.COMMAND,
                           handle_email_verification)
        ],
        REFERRAL_CODE_INPUT: [
            MessageHandler(filters.TEXT & ~filters.COMMAND,
                           handle_user_referral_input)
        ],
        ADMIN_CODE_INPUT: [
            MessageHandler(filters.TEXT & ~filters.COMMAND,
                           handle_admin_code_input)
        ],
        SET_PASSWORD: [
            MessageHandler(filters.TEXT & ~filters.COMMAND,
                           handle_password_setup)
        ],
        CONFIRM_PASSWORD: [
            MessageHandler(filters.TEXT & ~filters.COMMAND,
                           handle_password_confirmation)
        ],
    },
    fallbacks=[CommandHandler('cancel', cancel)]
)

# ============= ERROR HANDLER =============


async def error_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle errors."""
    logger.error(
        f"Update {update} caused error {context.error}", exc_info=context.error)
    if update and update.effective_message:
        error_msg = handle_error(context.error, "telegram_bot")
        await update.effective_chat.send_message(error_msg)


async def force_timezone_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Force timezone selection (useful for testing)"""
    telegram_id = str(update.effective_user.id)

    # Clear current timezone
    session = await load_user_session(telegram_id, context)
    if session and 'timezone' in session:
        del session['timezone']
        await save_user_session(telegram_id, context, session)

    # Clear from context
    context.user_data.pop('user_timezone', None)

    # Clear timezone file
    timezone_file = Path(f'./user_timezones/{telegram_id}.txt')
    if timezone_file.exists():
        timezone_file.unlink()

    await update.message.reply_text(
        "🔄 **Timezone reset!**\n\n"
        "Your timezone has been cleared. You'll be prompted to set it again when creating a task."
    )


async def debug_tasks_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Debug command to check task storage"""
    telegram_id = str(update.effective_user.id)

    try:
        session = await load_user_session(telegram_id, context)
        if not session or not session.get('profile_id'):
            await update.message.reply_text("❌ No profile found. Use /start first.")
            return

        profile_id = session.get('profile_id')
        user_address = session.get('user_address', telegram_id)

        debug_info = f"🔍 Task Debug Info\n\n"
        debug_info += f"📝 Profile ID: {profile_id}\n"
        debug_info += f"👤 User Address: {user_address}\n\n"

        # Try to get tasks from Sui
        debug_info += "📋 Checking Sui for tasks...\n"
        tasks = sui.get_user_tasks(user_address)
        debug_info += f"✅ Found {len(tasks)} tasks on Sui\n\n"

        if tasks:
            debug_info += "📜 Task Details:\n"
            for i, task in enumerate(tasks, 1):
                task_id = task.get('id', 'unknown')
                status = task.get('status', 'unknown')
                due_date = task.get('due_date', 'none')
                encrypted_blob = task.get('encrypted_details_blob', 'none')

                debug_info += f"{i}. ID: {task_id}\n"
                debug_info += f"   Status: {status}\n"
                debug_info += f"   Due Date: {due_date}\n"
                debug_info += f"   Has Encrypted Blob: {'yes' if encrypted_blob and encrypted_blob != 'none' else 'no'}\n"

                # Try to decrypt if possible
                if encrypted_blob and encrypted_blob != 'none':
                    user_password = session.get(
                        'password') or context.user_data.get('password')
                    if user_password:
                        try:
                            private_key = await get_user_private_key(telegram_id, user_password)
                            if private_key:
                                decrypted_task = walrus.retrieve_encrypted_task(
                                    encrypted_blob, private_key)
                                if decrypted_task:
                                    task_name = decrypted_task.get(
                                        'task_name', 'Unknown')
                                    debug_info += f"   Decrypted Name: {task_name}\n"
                        except Exception as e:
                            debug_info += f"   Decryption Error: {str(e)[:50]}...\n"

                debug_info += "\n"

        # Check if we can create a test task
        debug_info += "🧪 Testing task creation...\n"
        try:
            # Create a simple test task data
            test_task_data = {
                'task_name': 'Test Debug Task',
                'description': 'This is a test task for debugging',
                'created_by': telegram_id,
                'created_at': datetime.now(pytz.UTC).isoformat(),
                'due_date': None,
                'status': 'pending'
            }

            # Get public key for encryption
            public_key = key_manager.get_user_public_key(telegram_id)
            if public_key:
                encrypted_blob_id = walrus.store_encrypted_task(
                    public_key, test_task_data)
                debug_info += f"✅ Can encrypt tasks: yes (blob: {encrypted_blob_id[:20]}...)\n"
            else:
                debug_info += "❌ No public key found\n"

        except Exception as e:
            debug_info += f"❌ Encryption test failed: {str(e)[:100]}...\n"

        await update.message.reply_text(debug_info)

    except Exception as e:
        logger.error(f"Error in debug_tasks: {e}")
        await update.message.reply_text(f"❌ Debug error: {str(e)}")


# Add to your command handlers:

# ============= MAIN =============
def create_telegram_application(token: str):
    '''Create and configure the Telegram bot application'''
    application = Application.builder().token(token).build()

    # Add all your existing handlers here
    application.add_handler(CommandHandler("help", help_command))
    application.add_handler(CommandHandler("security", security_command))
    application.add_handler(CommandHandler(
        "generate_codes", admin_generate_codes))
    application.add_handler(CommandHandler("check_code", admin_check_code))
    application.add_handler(CommandHandler(
        "complete_task", complete_task_command))
    application.add_handler(CommandHandler("my_tasks", my_tasks_command))
    application.add_handler(signup_handler)
    application.add_handler(CallbackQueryHandler(
        handle_signup_choice, pattern='^signup_'))
    application.add_error_handler(error_handler)
    application.add_handler(checkin_handler)
    application.add_handler(checkin_status_handler)
    application.add_handler(check_my_profile_handler)
    application.add_handler(leaderboard_handler)
    application.add_handler(refresh_leaderboard_button_handler)
    application.add_handler(task_conv_handler)
    application.add_handler(setup_callback_handler)
    application.add_handler(CommandHandler("timezone", timezone_command))
    application.add_handler(CommandHandler("debug_task", debug_tasks_command))
    application.add_handler(CommandHandler(
        "reset_timezone", force_timezone_command))
    application.add_handler(portfolio_handler)

    return application


if __name__ == '__main__':
    main()
