"""
Copilot Telegram Bot - Blockchain-Backed Task Management with End-to-End Encryption
===================================================================================
"""
import base64
import html
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
from rate_limiter import rate_limiter
import os
import pytz
import re
from dotenv import load_dotenv
from typing import Dict, Optional, Any
from checkin import checkin_handler, checkin_status_handler, check_my_profile_handler
from leaderboard import leaderboard_handler, refresh_leaderboard_button_handler, quick_checkin_button_handler
from task_manager import task_conv_handler, setup_callback_handler, timezone_command, TaskManager, timezone_callback_handler, task_completion_handler
from portfolio_command import portfolio_handler
from waitlist import WaitlistManager
from cryptography.hazmat.primitives import hashes, serialization
from secure_storage import encrypt_and_save, load_and_decrypt
from utils import (
    is_strong_password, auth_conv_handler, create_user_session_with_password, is_valid_email, is_valid_telegram_id,
    is_valid_referral_code, is_valid_admin_code, is_admin, load_user_session, clear_user_session,
    parse_natural_language_date, format_date_for_display,
    format_profile_data, format_task_data, ensure_user_has_keys,
    create_user_keys, get_user_private_key, handle_error, get_password_via_key_validation,
    get_walrus_client, get_key_manager, get_sui_client, user_sessions, load_user_timezone, save_user_session,
    recover_all_users_from_sessions, create_user_session_with_password,
    session_manager
)
from otp_manager import otp_manager
from encrypted_db import init_db
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization
from walrus_client_change import WalrusRegistrationManager, LocalEncryptedEmailIndex
import logging
import traceback
from threading import Thread
from http.server import HTTPServer, BaseHTTPRequestHandler

load_dotenv()

# ============= ERROR LOGGING SETUP =============
# Create logs directory if it doesn't exist
LOGS_DIR = Path(__file__).parent / "logs"
LOGS_DIR.mkdir(exist_ok=True)

# Configure file logging for errors
error_log_file = LOGS_DIR / f"bot_errors_{datetime.now().strftime('%Y%m%d')}.log"
file_handler = logging.FileHandler(error_log_file, encoding='utf-8')
file_handler.setLevel(logging.ERROR)
file_formatter = logging.Formatter(
    '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
file_handler.setFormatter(file_formatter)

# Get root logger and add file handler
root_logger = logging.getLogger()
root_logger.addHandler(file_handler)
root_logger.setLevel(logging.INFO)

# Create a specific logger for bot errors
bot_error_logger = logging.getLogger('bot_errors')
bot_error_logger.setLevel(logging.ERROR)

def log_error_to_file(error: Exception, context_info: str = "", user_id: int = None, update: Update = None):
    """
    Log detailed error information to file
    
    Args:
        error: The exception that occurred
        context_info: Additional context about where the error occurred
        user_id: The user ID if available
        update: The telegram Update object if available
    """
    error_details = {
        'timestamp': datetime.now(pytz.UTC).isoformat(),
        'error_type': type(error).__name__,
        'error_message': str(error),
        'context': context_info,
        'user_id': user_id,
        'traceback': traceback.format_exc()
    }
    
    if update:
        error_details['update_info'] = {
            'update_id': update.update_id if update else None,
            'message_text': update.message.text if update and update.message else None,
            'callback_data': update.callback_query.data if update and update.callback_query else None,
            'user_info': {
                'id': update.effective_user.id if update and update.effective_user else None,
                'username': update.effective_user.username if update and update.effective_user else None,
                'first_name': update.effective_user.first_name if update and update.effective_user else None
            } if update and update.effective_user else None
        }
    
    # Log as JSON for easy parsing
    bot_error_logger.error(json.dumps(error_details, indent=2))
    
    return error_details

# Configure logging for registration errors
os.makedirs('logs', exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('logs/registration_errors.log'),
        logging.StreamHandler()
    ]
)

# Create separate logger for registration system
registration_logger = logging.getLogger('TelegramRegistration')
registration_logger.setLevel(logging.DEBUG)

# Add file handler specifically for registration
reg_handler = logging.FileHandler('logs/registration_errors.log')
reg_handler.setLevel(logging.ERROR)
reg_formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - [%(funcName)s:%(lineno)d] - %(message)s')
reg_handler.setFormatter(reg_formatter)
registration_logger.addHandler(reg_handler)

walrus = get_walrus_client()
key_manager = get_key_manager()
sui = get_sui_client()

# Conversation states
TASK_DESCRIPTION, TASK_INPUT, EMAIL_INPUT, WALLET_INPUT, TIMEZONE_INPUT = range(5)

SELECT_TASK, CONFIRM_DELETE, SET_PASSWORD, CONFIRM_PASSWORD = range(5, 9)

SELECT_METHOD, REFERRAL_CODE_INPUT, ADMIN_CODE_INPUT, EMAIL_VERIFICATION, OTP_VERIFICATION = range(9, 14)

PASSWORD_RESET_EMAIL, PASSWORD_RESET_OTP, NEW_PASSWORD_SETUP = range(14, 17)
WALLET_RECOVERY_STATE = 101
SESSION_RECOVERY_STATE = 104
SELECT_EXPORT_METHOD, EXPORT_PASSWORD, EXPORT_MNEMONIC = range(105, 108)
USERNAME_SETUP = 200

ADMIN_IDS = set(os.getenv('ADMIN_TELEGRAM_IDS', '').split(','))

# ============= REGISTRATION SYSTEM INTEGRATION =============
class TelegramRegistrationSystem:
    """Registration system adapted for Telegram bot."""

    def __init__(self):
        self.sui_client = sui
        self.walrus_client = walrus
        self.key_manager = key_manager
        self.active_registrations = {}

    async def display_welcome(self, update: Update):
        """Display welcome message."""
        welcome_msg = (
            "Welcome to Tovira Bot!\n\n"
            "YOUR AI POWERED CRYPTO COMPANION\n\n"
            "This bot is currently in testnet phase. It provides:\n\n"
            "• End to End encrypted Task manager\n"
            "• Research and Sentiment Analysis\n"
            "• Seamless Wallet Monitoring\n"
            "• Point system for rewards and incentives\n"
            "• Premium features\n\n"
            "Data Encryption Powered by walrus.\n"
            "Built on Sui, Built for You!"
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
            context.user_data['password_prompt_msg'] = progress_msg
            return SET_PASSWORD
        except Exception as e:
            log_error_to_file(e, "RegistrationFlow:create_user_password", 
                             update.effective_user.id if update and update.effective_user else None, update)
            registration_logger.error(
                f"Password setup failed: {str(e)}\n"
                f"Traceback: {traceback.format_exc()}"
            )
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
            public_key_str, encrypted_private = self.key_manager.create_user_keys(telegram_id, password)
            context.user_data['public_key'] = public_key_str.encode('utf-8')
            context.user_data['has_encryption_keys'] = True
            await asyncio.sleep(2)
            try:
                await progress_msg.delete()
            except:
                pass
            return True
        except Exception as e:
            registration_logger.error(
                f"Key generation failed for user {telegram_id}: {str(e)}\n"
                f"Traceback: {traceback.format_exc()}"
            )
            if progress_msg:
                await progress_msg.edit_text("⚠️ Failed to generate encryption keys.")
                await asyncio.sleep(3)
                try:
                    await progress_msg.delete()
                except Exception as msg_error:
                    registration_logger.error(f"Failed to delete message: {str(msg_error)}")
            return False

    async def encrypt_and_upload_data(self, user_data: Dict[str, Any], public_key: bytes, update: Update) -> Optional[str]:
        """Encrypt user data and upload to Walrus."""
        progress_msg = None
        try:
            progress_msg = await update.effective_chat.send_message("🔐 Encrypting your data...")
            blob_id = self.walrus_client.store_encrypted_user_data(public_key, user_data)
            if blob_id:
                await progress_msg.edit_text("✅ Data encrypted and stored securely!")
                await asyncio.sleep(2)
                try:
                    await progress_msg.delete()
                except:
                    pass
                return blob_id
            else:
                await progress_msg.edit_text("❌ Failed to store encrypted data.")
                await asyncio.sleep(3)
                try:
                    await progress_msg.delete()
                except:
                    pass
                return None
        except Exception as e:
            registration_logger.error(
                f"Data encryption/upload failed: {str(e)}\n"
                f"Traceback: {traceback.format_exc()}"
            )
            if progress_msg:
                await progress_msg.edit_text("❌ Error encrypting data.")
                await asyncio.sleep(3)
                try:
                    await progress_msg.delete()
                except Exception as msg_error:
                    registration_logger.error(f"Failed to delete message: {str(msg_error)}")
            return None

    async def select_registration_method(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Show registration button and proceed directly to password setup."""
        keyboard = [
            [InlineKeyboardButton("🆕 Signup with TOVIRA", callback_data='signup_no_code')],
        ]
        reply_markup = InlineKeyboardMarkup(keyboard)

        await update.message.reply_text(
            "⛓️ Register with Tovira\n\n"
            "Click the button below to start registration:",
            reply_markup=reply_markup
        )
        return SELECT_METHOD

    async def create_sui_wallet(self, user_id: str, password: str, update: Update,
                                context: ContextTypes.DEFAULT_TYPE) -> Optional[Dict[str, str]]:
        """Create Sui wallet and store IMMORTALLY on Walrus."""
        try:
            from sui_wallet_manager import SuiWalletManager

            progress_msg = await update.effective_chat.send_message("Creating your secure Sui blockchain wallet...")

            wallet_manager = SuiWalletManager(storage_path='./user_wallets')
            wallet_info = wallet_manager.create_wallet_for_user(
                user_id=user_id,
                password=password,
                word_count=12
            )

            if not wallet_info:
                await progress_msg.edit_text("Failed to generate wallet")
                await asyncio.sleep(3)
                await progress_msg.delete()
                return None

            key_manager = get_key_manager()

            wallet_data = {
                "telegram_id": user_id,
                "wallet_info": wallet_info,
                "mnemonic": wallet_info['mnemonic'],
                "address": wallet_info['address'],
                "created_at": datetime.now().isoformat(),
                "type": "sui_wallet",
                "version": 1
            }

            wallet_blob_id = key_manager.store_encrypted_object(wallet_data, user_id, password)

            if not wallet_blob_id:
                await progress_msg.edit_text("Failed to secure wallet on decentralized storage")
                await asyncio.sleep(3)
                await progress_msg.delete()
                return None

            context.user_data['wallet_blob_id'] = wallet_blob_id
            context.user_data['wallet_address'] = wallet_info['address']

            encrypted_wallet_path = f"./user_wallets/{user_id}_wallet.json.enc"
            encrypt_and_save(wallet_info, encrypted_wallet_path)

            await progress_msg.edit_text("✅ Wallet created & secured on decentralized storage!")
            await asyncio.sleep(2)
            await progress_msg.delete()

            mnemonic_msg = await update.effective_chat.send_message(
                "SAVE YOUR RECOVERY PHRASE NOW\n\n"
                f"Mnemonic (12 words):\n\n"
                f"`{wallet_info['mnemonic']}`\n\n"
                "THIS IS THE ONLY TIME YOU WILL SEE IT\n"
                "• Write it down on paper\n"
                "• Never take a screenshot\n"
                "• Never share it\n"
                "• You will NOT be able to recover it later",
                parse_mode='Markdown'
            )

            asyncio.create_task(delete_message_after_delay(mnemonic_msg, 172800))

            confirm_msg = await update.effective_chat.send_message(
                "Type **YES** when you have safely saved your 12-word phrase:"
            )
            context.user_data.update({
                'wallet_confirm_msg': confirm_msg,
                'temp_wallet_info': wallet_info,
                'wallet_encrypted': True,
                'wallet_blob_id': wallet_blob_id,
                'awaiting_wallet_confirmation': True,
                'mnemonic_retry_count': 0
            })

            return wallet_info

        except Exception as e:
            registration_logger.error(
                f"Wallet creation failed for user {user_id}: {str(e)}\n"
                f"Traceback: {traceback.format_exc()}"
            )
            try:
                await progress_msg.edit_text("Wallet creation failed. Please try again.")
                await asyncio.sleep(3)
                await progress_msg.delete()
            except Exception as msg_error:
                registration_logger.error(f"Failed to send error message: {str(msg_error)}")
            return None

    async def register_on_blockchain_with_wallet(self, blob_id: str, user_wallet_address: str,
                                                 registration_method: int, update: Update) -> Optional[Dict[str, str]]:
        """Register user on blockchain with their wallet address."""
        progress_msg = None
        try:
            progress_msg = await update.effective_chat.send_message(" Registering your profile on Sui blockchain...")

            if registration_method == 1:
                result = self.sui_client.create_user_profile_with_wallet(blob_id, user_wallet_address)
            else:
                result = self.sui_client.create_user_profile_with_wallet(blob_id, user_wallet_address)

            if result and result.get('profile_id'):
                await progress_msg.edit_text("✅ Blockchain registration successful!")
                await asyncio.sleep(2)
                try:
                    await progress_msg.delete()
                except:
                    pass
                return result
            else:
                await progress_msg.edit_text("⚠️ Blockchain registration failed. Continuing with local registration...")
                await asyncio.sleep(3)
                try:
                    await progress_msg.delete()
                except:
                    pass
                return {
                    'profile_id': None,
                    'tx_digest': 'local_registration',
                    'user_wallet': user_wallet_address
                }

        except Exception as e:
            registration_logger.error(
                f"Blockchain registration failed for wallet {user_wallet_address}: {str(e)}\n"
                f"Traceback: {traceback.format_exc()}"
            )
            if progress_msg:
                await progress_msg.edit_text("⚠️ Blockchain registration failed. Continuing with local registration...")
                await asyncio.sleep(3)
                try:
                    await progress_msg.delete()
                except Exception as msg_error:
                    registration_logger.error(f"Failed to delete message: {str(msg_error)}")
            return {
                'profile_id': None,
                'tx_digest': 'local_registration',
                'user_wallet': user_wallet_address
            }

    async def save_registration_receipt(self, user_data: Dict[str, Any],
                                        registration_result: Dict[str, str],
                                        blob_id: str, wallet_info: Dict[str, str]) -> str:
        """Save comprehensive registration receipt."""
        receipt = {
            'user_info': {
                'username': user_data['username'],
                'telegram_id': user_data['telegram_id'],
                'email': user_data.get('email', ''),
                'waitlist_verified': True
            },
            'blockchain': {
                'profile_id': registration_result.get('profile_id'),
                'tx_digest': registration_result.get('tx_digest', 'local_registration'),
                'wallet_address': wallet_info['address']
            },
            'storage': {
                'walrus_blob_id': blob_id,
                'encryption_keys_path': f"./user_keys/{user_data['telegram_id']}.*",
                'wallet_path': f"./user_wallets/{user_data['telegram_id']}_wallet.json"
            },
            'registration': {
                'method': 'direct',
                'registered_at': datetime.now().isoformat(),
                'registration_source': 'telegram_bot'
            }
        }

        receipts_dir = Path('./registration_receipts')
        receipts_dir.mkdir(exist_ok=True)

        filename = f"{user_data['telegram_id']}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        receipt_path = receipts_dir / filename

        encrypt_and_save(receipt, receipt_path.with_suffix('.enc'))

        return str(receipt_path)

    async def display_success_summary(self, registration_result: Dict[str, str],
                                      blob_id: str, wallet_info: Dict[str, str],
                                      receipt_path: str, update: Update):
        """Display final success summary."""
        success_msg = (
            "🎉 Congratulations! Your registration is complete!\n\n"
            "YOUR ACCOUNT DETAILS:\n"
            f"• Profile ID: {registration_result.get('profile_id', 'Local Only')}\n"
            f"• Wallet Address: {wallet_info['address']}\n\n"
            " CRITICAL - BACKUP THESE:\n"
            "1. Your password (needed for wallet access)\n"
            "2. Your mnemonic phrase (wallet recovery)\n\n"
            "NEXT STEPS:\n"
            "• Use the Tovira Telegram bot\n"
            "• Your wallet is ready for blockchain transactions!\n"
            ". Use /help"
        )
        await update.effective_chat.send_message(success_msg)

    async def run_registration(self, telegram_id: str, username: str, password: str,
                               context: ContextTypes.DEFAULT_TYPE, update: Update) -> bool:
        """Run the complete registration flow with wallet creation."""
        progress_msg = None
        try:
            email = context.user_data.get('verified_email')

            user_data = await self.collect_user_info(telegram_id, username, 1)
            user_data['email'] = email
            user_data['waitlist_verified'] = True
            user_data['verified_at'] = datetime.now().isoformat()

            context.user_data['user_data'] = user_data

            progress_msg = await update.effective_chat.send_message("🔄 Starting registration process...")
            await asyncio.sleep(2)
            try:
                await progress_msg.delete()
            except:
                pass

            progress_msg = await update.effective_chat.send_message("🔑 Generating encryption keys...")
            if not await self.generate_keys(telegram_id, password, context):
                await asyncio.sleep(2)
                try:
                    await progress_msg.delete()
                except:
                    pass
                return False
            await asyncio.sleep(2)
            try:
                await progress_msg.delete()
            except:
                pass

            progress_msg = await update.effective_chat.send_message(" Creating your Sui blockchain wallet...")
            wallet_info = await self.create_sui_wallet(telegram_id, password, update, context)
            await asyncio.sleep(2)
            try:
                await progress_msg.delete()
            except:
                pass

            if not wallet_info:
                return False

            context.user_data['awaiting_wallet_confirmation'] = True
            return True

        except Exception as e:
            registration_logger.error(
                f"Full registration flow failed for user {telegram_id}: {str(e)}\n"
                f"Traceback: {traceback.format_exc()}"
            )
            if progress_msg:
                await progress_msg.edit_text("❌ Registration failed. Please try again.")
                await asyncio.sleep(3)
                try:
                    await progress_msg.delete()
                except Exception as msg_error:
                    registration_logger.error(f"Failed to delete message: {str(msg_error)}")
            return False

    async def create_session_alternative(self, telegram_id: str, password: str,
                                         context: ContextTypes.DEFAULT_TYPE) -> bool:
        """Alternative session creation when standard method fails"""
        try:
            from secure_storage import create_session_token

            session_token = create_session_token(str(telegram_id), password)
            if not session_token:
                return False

            session_data = {
                'telegram_id': telegram_id,
                'session_token': session_token,
                'last_login': datetime.now(pytz.UTC).isoformat(),
                'session_created_at': datetime.now(pytz.UTC).isoformat(),
                'session_method': 'alternative'
            }

            success = await session_manager.save_user_session(telegram_id, session_data, password)

            if success:
                return True
            else:
                return False

        except Exception as e:
            registration_logger.error(
                f"Alternative session creation failed for user {telegram_id}: {str(e)}\n"
                f"Traceback: {traceback.format_exc()}"
            )
            return False

    async def complete_registration(self, telegram_id: str, password: str,
                                    context: ContextTypes.DEFAULT_TYPE, update: Update) -> bool:
        """Complete registration — BULLETPROOF SESSION CREATION"""
        progress_msg = None
        try:
            user_data = context.user_data.get('user_data', {})
            wallet_info = context.user_data.get('temp_wallet_info', {})

            username = context.user_data.get('username', '')
            telegram_username = context.user_data.get('telegram_username', '')
            first_name = context.user_data.get('first_name', '')

            if not username:
                if telegram_username:
                    username = telegram_username
                elif first_name:
                    username = first_name
                else:
                    username = f"User#{telegram_id[-4:]}"

            if not wallet_info:
                await update.effective_chat.send_message("❌ Wallet missing. Please /start again.")
                return False

            progress_msg = await update.effective_chat.send_message("🔐 Securing your wallet backup...")

            key_manager = get_key_manager()

            wallet_data = {
                "telegram_id": telegram_id,
                "wallet_info": wallet_info,
                "mnemonic": wallet_info['mnemonic'],
                "address": wallet_info['address'],
                "created_at": datetime.now().isoformat(),
                "type": "sui_wallet",
                "version": 1
            }

            wallet_blob_id = key_manager.store_encrypted_object(wallet_data, telegram_id, password)

            if not wallet_blob_id:
                await progress_msg.edit_text(
                    "❌ **CRITICAL: Wallet Backup Failed**\n\n"
                    "Your wallet was created but the backup failed.\n\n"
                    "**DO NOT CONTINUE** - Please contact support immediately."
                )
                await asyncio.sleep(10)
                return False

            await progress_msg.edit_text("🔍 Verifying wallet backup...")

            verification_data = key_manager.retrieve_encrypted_object(wallet_blob_id, telegram_id, password)
            if not verification_data or 'mnemonic' not in verification_data:
                await progress_msg.edit_text(
                    "❌ **CRITICAL: Wallet Backup Verification Failed**\n\n"
                    "Your wallet backup could not be verified.\n\n"
                    "**DO NOT CONTINUE** - Please contact support immediately."
                )
                await asyncio.sleep(10)
                return False

            await progress_msg.edit_text("✅ Wallet secured! Generating encryption keys...")

            public_key_obj, key_blob_id = await key_manager.create_and_upload_keys(
                telegram_id=str(telegram_id),
                password=password.strip()
            )

            if not public_key_obj or not key_blob_id:
                await progress_msg.edit_text("❌ Failed to secure keys on Walrus")
                await asyncio.sleep(5)
                return False

            public_pem = public_key_obj.public_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PublicFormat.SubjectPublicKeyInfo
            )

            await progress_msg.edit_text("📝 Encrypting your profile on Walrus...")
            walrus_client = get_walrus_client()
            profile_blob_id = walrus_client.store_encrypted_user_data(public_pem, user_data)

            if not profile_blob_id:
                await progress_msg.edit_text("❌ Failed to encrypt profile data")
                await asyncio.sleep(5)
                return False

            await progress_msg.edit_text("⛓️ Registering on Sui blockchain...")
            registration_result = await self.register_on_blockchain_with_wallet(
                profile_blob_id, wallet_info['address'], 1, update
            )

            if not registration_result:
                await progress_msg.edit_text("⚠️ Blockchain registration failed. Continuing with local registration...")
                registration_result = {
                    'profile_id': None,
                    'tx_digest': 'local_registration',
                    'user_wallet': wallet_info['address']
                }

            await progress_msg.edit_text("💾 Creating permanent registration record...")

            registration_manager = WalrusRegistrationManager(key_manager)
            receipt_blob_id = registration_manager.store_registration_receipt(
                user_data=user_data,
                registration_result=registration_result,
                blob_id=profile_blob_id,
                wallet_info=wallet_info,
                password=password
            )

            if not receipt_blob_id:
                await progress_msg.edit_text("⚠️ Failed to create registration record. Continuing...")
                receipt_blob_id = "local_receipt"

            await progress_msg.edit_text("🔐 Creating your secure session...")

            session_created = await create_user_session_with_password(telegram_id, password, context)

            if not session_created:
                session_created = await self.create_session_alternative(telegram_id, password, context)

                if not session_created:
                    await progress_msg.edit_text(
                        "❌ **CRITICAL: Session Creation Failed**\n\n"
                        "We couldn't create your session. This is required for the bot to work.\n\n"
                        "**Please try:**\n"
                        "1. Wait a moment and use `/start` again\n"
                        "2. Use a different password\n"
                        "3. Contact support immediately\n\n"
                        "Your data is safe in Walrus storage."
                    )
                    return False

            session = await session_manager.load_user_session(telegram_id, password) or {}

            complete_session = {
                'registration_complete': True,
                'profile_id': registration_result.get('profile_id'),
                'wallet_address': wallet_info['address'],
                'wallet_blob_id': wallet_blob_id,
                'key_blob_id': key_blob_id,
                'public_pem': public_pem.decode('utf-8'),
                'profile_blob_id': profile_blob_id,
                'receipt_blob_id': receipt_blob_id,
                'has_encryption_keys': True,
                'username': username,
                'telegram_username': telegram_username,
                'first_name': first_name,
                'username_set_at': datetime.now().isoformat(),
                'points': 0,
                'registration_date': datetime.now().isoformat(),
                'last_login': datetime.now().isoformat(),
                'session_status': 'active'
            }

            session.update(complete_session)

            save_success = await session_manager.save_user_session(telegram_id, session, password)

            if not save_success:
                await progress_msg.edit_text(
                    "❌ **Session Save Failed**\n\n"
                    "We created your session but couldn't save it properly.\n\n"
                    "Please use `/recover_session` immediately to restore your access."
                )
                return False

            verified_session = await session_manager.load_user_session(telegram_id, password)
            if not verified_session or not verified_session.get('has_encryption_keys'):
                await progress_msg.edit_text(
                    "⚠️ **Session Verification Issue**\n\n"
                    "Your registration completed but session verification failed.\n\n"
                    "Please use `/recover_session` to ensure everything works properly."
                )

            try:
                email_index = LocalEncryptedEmailIndex()
                email = user_data.get('email')

                if email:
                    success = email_index.add_email_mapping(email, telegram_id)
            except Exception as e:
                pass

            await self.display_success_summary(
                registration_result, profile_blob_id, wallet_info, receipt_blob_id, update, username
            )

            await progress_msg.delete()
            return True

        except Exception as e:
            # Log the full error with traceback
            registration_logger.error(
                f"Registration failed for user {telegram_id}: {str(e)}\n"
                f"Traceback: {traceback.format_exc()}"
            )
            if progress_msg:
                try:
                    await progress_msg.edit_text("❌ Registration failed. Please try /start again.")
                    await asyncio.sleep(5)
                    await progress_msg.delete()
                except Exception as msg_error:
                    registration_logger.error(f"Failed to edit error message: {str(msg_error)}")
            return False

    async def display_success_summary(self, registration_result: Dict[str, str],
                                      blob_id: str, wallet_info: Dict[str, str],
                                      receipt_path: str, update: Update, username: str = None):
        """Display final success summary with username"""
        if not username:
            username = "User"

        success_msg = (
            f"🎉 Congratulations {username}!** Your registration is complete!\n\n"
            "YOUR ACCOUNT DETAILS:\n"
            f"• Username: {username}\n"
            f"• Profile ID: {registration_result.get('profile_id', 'Local Only')}\n"
            f"• Wallet Address:** {wallet_info['address']}\n\n"
            "**🔐 CRITICAL - BACKUP THESE:**\n"
            "1. Your password (needed for wallet access)\n"
            "2. Your mnemonic phrase (wallet recovery)\n"
            "• Use /help to continue!\n\n"
            f"Welcome to Tovira, {username}! 🎊"
        )
        await update.effective_chat.send_message(success_msg)

# ============= SESSION RECOVERY SYSTEM =============

async def recover_session_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Main command to recover user session and encryption keys"""
    telegram_id = str(update.effective_user.id)
    username = update.effective_user.username or update.effective_user.first_name or "User"

    password = await get_password_via_key_validation(telegram_id, context)
    session = await session_manager.load_user_session(telegram_id, password or "local_storage_fallback_password")

    if not session:
        wallet_files = list(Path('./user_wallets').glob(f"{telegram_id}*"))
        if not wallet_files:
            await update.message.reply_text(
                "❌ **No Account Found**\n\n"
                "We couldn't find any registration data for you.\n\n"
                "Please use `/start` to create a new account first."
            )
            return ConversationHandler.END
        else:
            await update.message.reply_text(
                "🔄 Account Recovery Needed\n\n"
                "We found your wallet but your session is missing.\n\n"
                "Please enter your password to rebuild your session:"
            )
            context.user_data['recovering_zombie'] = True
            return SESSION_RECOVERY_STATE

    if session.get('registration_complete') and session.get('has_encryption_keys'):
        await update.message.reply_text(
            "✅ Your Session is Already Active!\n\n"
            "Your encryption keys are loaded and everything is working.\n\n"
            "If you're experiencing issues, try:\n"
            "• `/start` - Refresh your session\n"
            "• `/diagnostic` - Check system status"
        )
        return ConversationHandler.END

    elif session.get('registration_complete') and not session.get('has_encryption_keys'):
        await update.message.reply_text(
            "🔑 Encryption Keys Missing\n\n"
            "Your account exists but encryption keys are missing.\n\n"
            "Please enter your password to recover your keys:"
        )
        context.user_data['recovering_keys'] = True
        return SESSION_RECOVERY_STATE

    else:
        await update.message.reply_text(
            "⚠️ Incomplete Registration\n\n"
            "Your registration wasn't completed properly.\n\n"
            "Please use `/start` to complete your registration."
        )
        return ConversationHandler.END

async def handle_session_recovery(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle password input for session recovery"""
    telegram_id = str(update.effective_user.id)
    password = update.message.text.strip()

    try:
        await update.message.delete()
    except:
        pass

    progress_msg = await update.effective_chat.send_message("🔄 Starting recovery process...")

    try:
        recovery_type = (
            'zombie' if context.user_data.get('recovering_zombie') else
            'keys' if context.user_data.get('recovering_keys') else
            'unknown'
        )

        if recovery_type == 'zombie':
            result = await recover_zombie_user(telegram_id, password, progress_msg)
        elif recovery_type == 'keys':
            result = await recover_missing_keys(telegram_id, password, progress_msg)
        else:
            result = await recover_generic(telegram_id, password, progress_msg)

        if result:
            await progress_msg.edit_text(result['message'])

            if result['success']:
                await asyncio.sleep(2)
                await update.effective_chat.send_message(
                    "🎉 **Recovery Complete!**\n\n"
                    "You can now use all bot features:\n"
                    "• `/checkin` - Daily points ✅\n"
                    "• `/new_task` - Create tasks ✅\n"
                    "• `/portfolio` - View wallet ✅\n"
                    "• `/leaderboard` - See ranking ✅\n\n"
                    "**Welcome back!** 🚀"
                )

        else:
            await progress_msg.edit_text(
                "❌ **Recovery Failed**\n\n"
                "We couldn't recover your session with that password.\n\n"
                "**Please try:**\n"
                "• Check your password and try again\n"
                "• Use `/start` for fresh registration\n"
                "• Contact support if this continues"
            )

    except Exception as e:
        await progress_msg.edit_text(
            "❌ **Recovery Error**\n\n"
            "An unexpected error occurred during recovery.\n\n"
            "Please try again or contact support."
        )

    context.user_data.clear()
    return ConversationHandler.END

async def recover_zombie_user(telegram_id: str, password: str, progress_msg) -> Dict[str, Any]:
    """Recover users with wallet files but no session"""
    try:
        await progress_msg.edit_text("🔍 Found your wallet, rebuilding session...")

        wallet_files = list(Path('./user_wallets').glob(f"{telegram_id}*"))
        if not wallet_files:
            return {
                'success': False,
                'message': "❌ Wallet files not found. Please use /start."
            }

        try:
            from secure_storage import load_and_decrypt
            wallet_data = load_and_decrypt(wallet_files[0])
            if not wallet_data:
                return {
                    'success': False,
                    'message': "❌ Wrong password or corrupted wallet."
                }
        except:
            return {
                'success': False,
                'message': "❌ Wrong password. Please try again."
            }

        await progress_msg.edit_text("✅ Password verified! Recovering keys...")

        key_manager = get_key_manager()

        key_blob_patterns = [
            f"{telegram_id}_keys",
            f"keys_{telegram_id}",
            f"{telegram_id}_encryption_keys"
        ]

        public_key = None
        key_blob_id = None

        for blob_id in key_blob_patterns:
            try:
                public_key, encrypted_private = await key_manager.retrieve_keys_from_walrus(
                    blob_id, telegram_id, password
                )
                if public_key:
                    key_blob_id = blob_id
                    break
            except:
                continue

        if not public_key:
            await progress_msg.edit_text("🔑 No existing keys found, generating new ones...")
            public_key_obj, key_blob_id = await key_manager.create_and_upload_keys(
                telegram_id=str(telegram_id),
                password=password.strip()
            )
            public_key = public_key_obj

        session_data = {
            'telegram_id': telegram_id,
            'registration_complete': True,
            'has_encryption_keys': True,
            'wallet_address': wallet_data.get('address', 'recovered'),
            'key_blob_id': key_blob_id,
            'public_key': public_key,
            'public_pem': public_key.public_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PublicFormat.SubjectPublicKeyInfo
            ).decode('utf-8'),
            'points': 1,
            'last_login': datetime.now(pytz.UTC).isoformat(),
            'session_recovered': True,
            'recovered_at': datetime.now(pytz.UTC).isoformat()
        }

        success = await session_manager.save_user_session(telegram_id, session_data, password)

        if success:
            return {
                'success': True,
                'message': "✅ **Session Recovered Successfully!**\n\nYour account has been fully restored with encryption keys."
            }
        else:
            return {
                'success': False,
                'message': "❌ Failed to save recovered session."
            }

    except Exception as e:
        return {
            'success': False,
            'message': f"❌ Recovery error: {str(e)}"
        }

async def recover_missing_keys(telegram_id: str, password: str, progress_msg) -> Dict[str, Any]:
    """Recover encryption keys for users with session but missing keys"""
    try:
        await progress_msg.edit_text("🔑 Recovering your encryption keys...")

        session = await session_manager.load_user_session(telegram_id, password)
        if not session:
            return {
                'success': False,
                'message': "❌ No session found with that password."
            }

        key_blob_id = session.get('key_blob_id')
        key_manager = get_key_manager()

        if key_blob_id:
            await progress_msg.edit_text("🔍 Retrieving keys from secure storage...")
            public_key, encrypted_private = await key_manager.retrieve_keys_from_walrus(
                key_blob_id, telegram_id, password
            )

            if public_key:
                session['has_encryption_keys'] = True
                session['public_key'] = public_key
                session['encrypted_private_key'] = encrypted_private
                session['public_pem'] = public_key.public_bytes(
                    encoding=serialization.Encoding.PEM,
                    format=serialization.PublicFormat.SubjectPublicKeyInfo
                ).decode('utf-8')
                session['keys_recovered_at'] = datetime.now(pytz.UTC).isoformat()

                await session_manager.save_user_session(telegram_id, session, password)

                return {
                    'success': True,
                    'message': "✅ **Encryption Keys Recovered!**\n\nYour keys have been restored successfully."
                }

        await progress_msg.edit_text("🔍 Searching for your keys...")

        key_blob_patterns = [
            f"{telegram_id}_keys",
            f"keys_{telegram_id}",
            f"{telegram_id}_encryption_keys"
        ]

        for blob_id in key_blob_patterns:
            try:
                public_key, encrypted_private = await key_manager.retrieve_keys_from_walrus(
                    blob_id, telegram_id, password
                )
                if public_key:
                    session['has_encryption_keys'] = True
                    session['public_key'] = public_key
                    session['encrypted_private_key'] = encrypted_private
                    session['key_blob_id'] = blob_id
                    session['public_pem'] = public_key.public_bytes(
                        encoding=serialization.Encoding.PEM,
                        format=serialization.PublicFormat.SubjectPublicKeyInfo
                    ).decode('utf-8')
                    session['keys_recovered_at'] = datetime.now(pytz.UTC).isoformat()

                    await session_manager.save_user_session(telegram_id, session, password)

                    return {
                        'success': True,
                        'message': "✅ Encryption Keys Found & Restored!\n\nYour keys have been recovered successfully."
                    }
            except:
                continue

        await progress_msg.edit_text("🔑 Generating new encryption keys...")
        public_key_obj, new_blob_id = await key_manager.create_and_upload_keys(
            telegram_id=str(telegram_id),
            password=password.strip()
        )

        if public_key_obj:
            session['has_encryption_keys'] = True
            session['public_key'] = public_key_obj
            session['key_blob_id'] = new_blob_id
            session['public_pem'] = public_key_obj.public_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PublicFormat.SubjectPublicKeyInfo
            ).decode('utf-8')
            session['new_keys_generated'] = datetime.now(pytz.UTC).isoformat()

            await session_manager.save_user_session(telegram_id, session, password)

            return {
                'success': True,
                'message': "✅ New Encryption Keys Generated!\n\nNew keys have been created for your account."
            }
        else:
            return {
                'success': False,
                'message': "❌ Failed to generate new encryption keys."
            }

    except Exception as e:
        return {
            'success': False,
            'message': f"❌ Key recovery error: {str(e)}"
        }

async def recover_generic(telegram_id: str, password: str, progress_msg) -> Dict[str, Any]:
    """Generic recovery for unknown session issues"""
    try:
        await progress_msg.edit_text("🔍 Analyzing your account...")

        session = await session_manager.load_user_session(telegram_id, password)
        if not session:
            return {
                'success': False,
                'message': "❌ No session found with that password."
            }

        rebuilt_session = {
            'telegram_id': telegram_id,
            'registration_complete': True,
            'has_encryption_keys': True,
            'last_login': datetime.now(pytz.UTC).isoformat(),
            'session_repaired': True,
            'repaired_at': datetime.now(pytz.UTC).isoformat(),
            'points': session.get('points', 1)
        }

        for key in ['username', 'first_name', 'telegram_username', 'wallet_address', 'profile_id']:
            if key in session:
                rebuilt_session[key] = session[key]

        success = await session_manager.save_user_session(telegram_id, rebuilt_session, password)

        if success:
            return {
                'success': True,
                'message': "✅ **Session Repaired!**\n\nYour session has been rebuilt successfully."
            }
        else:
            return {
                'success': False,
                'message': "❌ Failed to repair session."
            }

    except Exception as e:
        return {
            'success': False,
            'message': f"❌ Recovery error: {str(e)}"
        }

# ============= START & ONBOARDING =============
async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """
    Handle /start — CORRECTLY SAVES USERNAME FOREVER
    NEVER SAVES "User" OR "Anonymous" AS USERNAME AGAIN
    """
    telegram_id = str(update.effective_user.id)

    real_username = update.effective_user.username
    real_first_name = update.effective_user.first_name or "User"
    display_name = real_username if real_username else real_first_name
    clean_username_for_storage = display_name.lstrip('@')

    password = await get_password_via_key_validation(telegram_id, context)
    session = await session_manager.load_user_session(telegram_id, password or "local_storage_fallback_password") or {}

    session['telegram_id'] = telegram_id
    session['username'] = clean_username_for_storage
    session['first_name'] = real_first_name
    session['last_seen'] = datetime.now(pytz.UTC).isoformat()

    await session_manager.save_user_session(telegram_id, session, password or "local_storage_fallback_password")

    has_keys = await ensure_user_has_keys(telegram_id, context)
    if has_keys:
        session = await session_manager.load_user_session(telegram_id, password or "local_storage_fallback_password")
        if session.get('profile_id'):
            points = session.get('points', 0)
            is_premium = session.get('is_premium', False)
            badge = " Premium" if is_premium else ""

            welcome_back = (
                f"Welcome back{badge}!\n\n"
                f"User: {html.escape(clean_username_for_storage)}\n"
                f"Points: {points} ⭐\n\n"
                f"FEATURES:\n"
                f"/new_task - Create task schedule\n"
                f"/task_history - View and manage your tasks\n"
                f"/portfolio - Monitor your SUI wallet and assets (NFTs, kiosk...)\n"
                f"/checkin - Daily +1 point\n\n"
                f"REWARDS:\n"
                f"/leaderboard - Check your rank and points!\n\n"
                f"Points are accrued for each activity done.\n\n"
                f"Testnet is in phases, more features coming soon."
            )
            await update.message.reply_text(welcome_back)
            return ConversationHandler.END

    await update.message.reply_text(
        "📧 Please enter your email address to verify waitlist access:"
    )
    return EMAIL_VERIFICATION

async def handle_email_verification(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle email input — WITH LOCAL ENCRYPTED INDEX"""
    email = update.message.text.strip().lower()

    if not re.match(r"^[^@]+@[^@]+\.[^@]+$", email):
        error_msg = await update.message.reply_text("Please enter a valid email address.")
        await asyncio.sleep(3)
        await error_msg.delete()
        return EMAIL_VERIFICATION

    checking_msg = await update.message.reply_text("Checking email...")

    try:
        email_index = LocalEncryptedEmailIndex()

        if email_index.email_exists(email):
            existing_user_id = email_index.get_telegram_id_by_email(email)

            await checking_msg.edit_text(
                "🚫 **Email Already Registered**\n\n"
                f"The email `{email}` is already registered.\n\n"
                "Please use a different email address or contact support if you believe this is an error."
            )
            return ConversationHandler.END

    except Exception as e:
        log_error_to_file(e, "handle_email_verification:email_index_check", 
                         update.effective_user.id if update.effective_user else None, update)

    whitelist_blob_id = os.getenv('WHITELIST_BLOB_ID')
    if whitelist_blob_id:
        waitlist_manager = WaitlistManager()
        try:
            is_whitelisted = waitlist_manager.is_email_whitelisted(email, whitelist_blob_id)
            if not is_whitelisted:
                await checking_msg.edit_text("❌ Access Denied: Please wait for referral codes to be released.")
                await asyncio.sleep(6)
                await checking_msg.delete()
                return ConversationHandler.END
        except Exception as e:
            log_error_to_file(e, "handle_email_verification:whitelist_check", 
                             update.effective_user.id if update.effective_user else None, update)

    await checking_msg.edit_text("✅ Email available! Sending verification code...")
    await asyncio.sleep(2)
    await checking_msg.delete()

    return await send_otp_for_verification(update, context, email)

async def delete_otp_prompt_after_10_minutes(context: ContextTypes.DEFAULT_TYPE, delay: int = 600):
    """
    Deletes the OTP prompt message after 10 minutes.
    Safe even if user already verified or message was deleted.
    """
    await asyncio.sleep(delay)

    msg = context.user_data.get('otp_prompt_message')
    if not msg:
        return

    try:
        await msg.delete()
    except telegram.error.BadRequest as e:
        if "message can't be deleted" in str(e) or "not found" in str(e):
            pass
    except Exception as e:
        pass
    finally:
        context.user_data.pop('otp_prompt_message', None)

async def send_otp_for_verification(update: Update, context: ContextTypes.DEFAULT_TYPE, email: str):
    """Send OTP for email verification — INSTANT RESPONSE, NO BLOCKING"""
    try:
        otp = otp_manager.generate_otp()
        telegram_id = str(update.effective_user.id)

        otp_id = otp_manager.save_otp(email, otp, 'registration', telegram_id)

        sending_msg = await update.message.reply_text("Sending verification code to your email...")
        success = await otp_manager.send_otp_email(email, otp, 'registration')

        if success:
            await sending_msg.edit_text(
                f"✅ Verification code sent to: {email}\n\n"
                f"📝 Please enter the 6-digit code you received:\n\n"
                f"⏰ The code expires in 10 minutes"
            )

            context.user_data['otp_prompt_message'] = sending_msg

            asyncio.create_task(delete_otp_prompt_after_10_minutes(context, delay=600))

            context.user_data['otp_id'] = otp_id
            context.user_data['verified_email'] = email
            return OTP_VERIFICATION

        else:
            # Log the email sending failure with context
            error_context = f"Email sending failed for {email} during registration"
            registration_logger.error(
                f"{error_context}\n"
                f"User ID: {telegram_id}\n"
                f"OTP ID: {otp_id}\n"
                f"Email: {email}\n"
                f"Check Render environment variables: EMAIL_USER, EMAIL_PASSWORD, SMTP_SERVER, SMTP_PORT"
            )
            
            await sending_msg.edit_text(
                "❌ Failed to send verification email.\n\n"
                "Please check:\n"
                "• Your email address is correct\n"
                "• Check your spam folder\n"
                "• Try again in a few minutes\n\n"
                "If this persists, contact support."
            )
            asyncio.create_task(delete_message_after_delay(sending_msg, 10))
            return ConversationHandler.END

    except Exception as e:
        log_error_to_file(e, "send_otp_for_verification", 
                         update.effective_user.id if update and update.effective_user else None, update)
        error_msg = await update.message.reply_text("Error sending verification code. Please try again.")
        asyncio.create_task(delete_message_after_delay(error_msg, 10))
        return ConversationHandler.END

async def handle_otp_verification(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle OTP verification and proceed to username setup."""
    otp_code = update.message.text.strip()
    otp_id = context.user_data.get('otp_id')

    if not otp_id:
        error_msg = "❌ Session error. Please start over with /start"
        await update.message.reply_text(error_msg)
        return ConversationHandler.END

    result = otp_manager.verify_otp(otp_id, otp_code)

    if result['valid']:
        email = result['email']
        telegram_id = str(update.effective_user.id)
        telegram_user = update.effective_user

        await update.message.reply_text("✅ Email verified successfully!")

        otp_prompt_msg = context.user_data.get('otp_prompt_message')
        if otp_prompt_msg:
            try:
                await otp_prompt_msg.delete()
            except:
                pass
            context.user_data.pop('otp_prompt_message', None)

        context.user_data['verified_email'] = email
        context.user_data['telegram_username'] = telegram_user.username
        context.user_data['first_name'] = telegram_user.first_name

        await ask_for_username(update, context)
        return USERNAME_SETUP
    else:
        error_msg = result.get('error', 'Invalid code')

        if 'expired' in error_msg.lower():
            await update.message.reply_text(
                "❌ Verification code has expired.\n\n"
                "Please use /start to begin again and get a new code."
            )
            return ConversationHandler.END
        else:
            await update.message.reply_text(
                f"❌ {error_msg}\n\n"
                f"Please enter the correct 6-digit code:"
            )
            return OTP_VERIFICATION

async def ask_for_username(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Ask user to set up their username with PROPER HTML escaping and security"""
    telegram_user = update.effective_user
    telegram_username = telegram_user.username
    first_name = telegram_user.first_name

    message_parts = [
        "👤 <b>Set Your Username</b>",
        "",
        "Choose a username that will appear in the leaderboard and across the platform!",
        ""
    ]

    if telegram_username:
        safe_telegram_username = html.escape(telegram_username)
        message_parts.append(f"<b>Your Telegram username:</b> @{safe_telegram_username}")
        message_parts.append("")

    message_parts.extend([
        "<b>Username Guidelines:</b>",
        "• 2-30 characters",
        "• Emojis and symbols welcome! 🎉",
        "• Be creative and unique!",
        ""
    ])

    keyboard = []
    if telegram_username:
        safe_callback_username = re.sub(r'[^a-zA-Z0-9_]', '_', telegram_username)
        safe_callback_username = safe_callback_username[:30]

        safe_display_username = html.escape(telegram_username[:15] + ('...' if len(telegram_username) > 15 else ''))

        message_parts.extend([
            f"💡 <i>Quick setup:</i> Press the button to use @{safe_display_username} or type a custom username:"
        ])

        keyboard.append([
            InlineKeyboardButton(
                f"Use @{safe_display_username}",
                callback_data=f"use_telegram_username:{safe_callback_username}"
            )
        ])
        keyboard.append([
            InlineKeyboardButton("Choose Custom Username", callback_data="choose_custom_username")
        ])
    else:
        message_parts.append("Enter your username:")

    message = "\n".join(message_parts)
    reply_markup = InlineKeyboardMarkup(keyboard) if keyboard else None

    await update.message.reply_text(message, reply_markup=reply_markup, parse_mode='HTML')

    if not telegram_username:
        return USERNAME_SETUP

async def handle_username_choice(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle username choice with safe callback data processing"""
    query = update.callback_query
    await query.answer()

    choice = query.data

    if choice.startswith('use_telegram_username:'):
        try:
            sanitized_username = choice.split(':', 1)[1]

            original_username = update.effective_user.username

            if original_username:
                context.user_data['username'] = original_username

                await query.edit_message_text(
                    f"✅ Username set to: <b>{html.escape(original_username)}</b>\n\n"
                    "Continuing to password setup...",
                    parse_mode='HTML'
                )

                registration_system = TelegramRegistrationSystem()
                return await registration_system.create_user_password(update, context)
            else:
                raise ValueError("Original username not found")

        except Exception as e:
            await query.edit_message_text(
                "❌ Error selecting username. Please type a custom username:",
                parse_mode='HTML'
            )
            return USERNAME_SETUP

    elif choice == 'choose_custom_username':
        await query.edit_message_text(
            "✏️ <b>Custom Username</b>\n\n"
            "Enter your custom username (2-30 characters):\n\n"
            "💡 <b>Tips:</b>\n"
            "• Emojis and symbols allowed! 🎉\n"
            "• This will be your display name everywhere",
            parse_mode='HTML'
        )
        return USERNAME_SETUP

def sanitize_username_for_storage(raw_username: str) -> str:
    """Sanitize username for safe storage while preserving most characters"""
    if not raw_username:
        return ""

    cleaned = re.sub(r'[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', raw_username)

    cleaned = cleaned.strip()

    if len(cleaned) > 30:
        cleaned = cleaned[:30]

    return cleaned

async def handle_registration_username(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle custom username input with proper sanitization"""
    telegram_id = str(update.effective_user.id)
    raw_username = update.message.text.strip()

    custom_username = sanitize_username_for_storage(raw_username)

    if len(custom_username) < 2:
        await update.message.reply_text(
            "❌ <b>Invalid Username</b>\n\n"
            "Username must be at least 2 characters long.\n\n"
            "Please enter a valid username:",
            parse_mode='HTML'
        )
        return USERNAME_SETUP

    if await is_username_taken(custom_username, telegram_id):
        await update.message.reply_text(
            "❌ <b>Username Already Taken</b>\n\n"
            "This username is already in use by another user.\n\n"
            "Please choose a different username:",
            parse_mode='HTML'
        )
        return USERNAME_SETUP

    context.user_data['username'] = custom_username

    await update.message.reply_text(
        f"✅ <b>Username Updated Successfully!</b>\n\n"
        f"<b>New Username:</b> {html.escape(custom_username)}\n\n"
        "Continuing to password setup...",
        parse_mode='HTML'
    )

    registration_system = TelegramRegistrationSystem()
    return await registration_system.create_user_password(update, context)

# ============= PASSWORD HANDLERS =============

async def delete_message_after_delay(message, delay: float = 0):
    """Standalone function to delete a message after delay."""
    if not message:
        return
    try:
        if delay > 0:
            await asyncio.sleep(delay)
        await message.delete()
    except telegram.error.BadRequest as e:
        pass
    except telegram.error.Forbidden as e:
        pass
    except Exception as e:
        pass

async def handle_password_setup(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle password input."""
    telegram_id = str(update.effective_user.id)
    password = update.message.text.strip()

    try:
        await update.message.delete()
    except Exception as e:
        pass

    is_valid, error_msg = is_strong_password(password)
    if not is_valid:
        error_msg_sent = await update.effective_chat.send_message(
            f"❌ {error_msg}\n\nTry again:"
        )
        await asyncio.sleep(3)
        try:
            await error_msg_sent.delete()
        except:
            pass
        return SET_PASSWORD

    context.user_data['temp_password'] = password
    success_msg = await update.effective_chat.send_message(
        "✅ Password accepted!\n\nConfirm password:"
    )
    asyncio.create_task(delete_message_after_delay(success_msg, 120))

    context.user_data['password_success_msg'] = success_msg
    return CONFIRM_PASSWORD

async def handle_password_confirmation_with_wallet(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle both password confirmation and wallet confirmation."""
    if context.user_data.get('awaiting_wallet_confirmation'):
        return await handle_wallet_confirmation(update, context)
    else:
        return await handle_password_confirmation(update, context)

async def handle_password_confirmation(update: Update, context: ContextTypes.DEFAULT_TYPE):
    telegram_id = str(update.effective_user.id)
    username = update.effective_user.username or update.effective_user.first_name
    confirmed_password = update.message.text.strip()

    try:
        await update.message.delete()
    except:
        pass
    if context.user_data.get('password_prompt_msg'):
        try:
            await context.user_data['password_prompt_msg'].delete()
        except:
            pass

    first_password = context.user_data.get('temp_password')
    if confirmed_password != first_password:
        await update.effective_chat.send_message("Passwords don't match! Use /start")
        context.user_data.clear()
        return ConversationHandler.END

    context.user_data['registration_password'] = first_password

    registration_system = context.application.bot_data.setdefault('registration_system', TelegramRegistrationSystem())
    registration_system.active_registrations[telegram_id] = {
        'password': first_password,
        'username': username,
        'timestamp': datetime.now().isoformat()
    }

    context.user_data.pop('temp_password', None)

    success = await registration_system.run_registration(
        telegram_id=telegram_id,
        username=username,
        password=first_password,
        context=context,
        update=update
    )

    if not success:
        await update.effective_chat.send_message("Registration failed. Try /start again.")
        registration_system.active_registrations.pop(telegram_id, None)
        return ConversationHandler.END

    return CONFIRM_PASSWORD

async def handle_wallet_confirmation(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle user confirmation of wallet mnemonic saving with proper validation."""
    raw_text = update.message.text.strip()
    user_response = raw_text.upper().strip()

    try:
        await update.message.delete()
    except Exception as e:
        pass

    telegram_id = str(update.effective_user.id)

    password = None
    registration_system = context.application.bot_data.get('registration_system')

    if registration_system and telegram_id in registration_system.active_registrations:
        password = registration_system.active_registrations[telegram_id].get('password')

    if not password:
        password = context.user_data.get('registration_password')

    if not password:
        password = context.user_data.get('temp_password')

    if not password:
        await update.effective_chat.send_message(
            "❌ Registration error: Password lost. Please use /start to begin again."
        )
        if registration_system and telegram_id in registration_system.active_registrations:
            registration_system.active_registrations.pop(telegram_id, None)
        context.user_data.clear()
        return ConversationHandler.END

    retry_count = context.user_data.get('mnemonic_retry_count', 0)

    if user_response in ['YES', 'Y', 'YEAH', 'OK', 'YES!', 'YESS', 'YUP']:
        confirm_msg = context.user_data.get('wallet_confirm_msg')
        if confirm_msg:
            try:
                await confirm_msg.delete()
            except:
                pass
            context.user_data.pop('wallet_confirm_msg', None)

        context.user_data.pop('mnemonic_retry_count', None)

        registration_system = TelegramRegistrationSystem()
        success = await registration_system.complete_registration(
            telegram_id=telegram_id,
            password=password,
            context=context,
            update=update
        )

        if registration_system and telegram_id in registration_system.active_registrations:
            registration_system.active_registrations.pop(telegram_id, None)
        context.user_data.pop('awaiting_wallet_confirmation', None)
        context.user_data.pop('temp_wallet_info', None)
        context.user_data.pop('registration_password', None)

        if success:
            await update.effective_chat.send_message(
                "✅ Wallet confirmed! Your account is now fully registered and secure."
            )
            return ConversationHandler.END
        else:
            await update.effective_chat.send_message("❌ Registration failed. Use /start to try again.")
            return ConversationHandler.END

    else:
        retry_count += 1
        context.user_data['mnemonic_retry_count'] = retry_count

        if retry_count == 1:
            warning_msg = await update.effective_chat.send_message(
                "⚠️ **IMPORTANT SECURITY WARNING** ⚠️\n\n"
                "You must save your recovery phrase to continue!\n\n"
                "• This is your **ONLY** backup\n"
                "• Without it, you lose access to your wallet forever\n"
                "• No one can recover it for you\n\n"
                "Please save the 12-word phrase and type **YES** to continue:"
            )
        elif retry_count == 2:
            warning_msg = await update.effective_chat.send_message(
                "🚨 **CRITICAL SECURITY ALERT** 🚨\n\n"
                "Your wallet cannot be recovered without the 12-word phrase!\n\n"
                "🔒 **You risk permanent loss of:**\n"
                "• All funds in this wallet\n"
                "• Any future assets\n"
                "• Access to your account\n\n"
                "Type **YES** only after you've saved the phrase securely:"
            )
        else:
            warning_msg = await update.effective_chat.send_message(
                "❌ **Registration Cancelled** ❌\n\n"
                "You have not confirmed saving your recovery phrase.\n\n"
                "For your security, registration has been cancelled.\n"
                "You can start over with /start when you're ready to properly secure your wallet.\n\n"
                "Remember: Without the recovery phrase, you cannot recover your wallet!"
            )

            if registration_system and telegram_id in registration_system.active_registrations:
                registration_system.active_registrations.pop(telegram_id, None)
            context.user_data.pop('awaiting_wallet_confirmation', None)
            context.user_data.pop('temp_wallet_info', None)
            context.user_data.pop('mnemonic_retry_count', None)
            context.user_data.pop('wallet_confirm_msg', None)
            context.user_data.pop('registration_password', None)

            asyncio.create_task(delete_message_after_delay(warning_msg, 15))
            return ConversationHandler.END

        asyncio.create_task(delete_message_after_delay(warning_msg, 15))

        return CONFIRM_PASSWORD

async def handle_verification_choice(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle user choice for registration verification."""
    user_response = update.message.text.strip().lower()

    telegram_id = str(update.effective_user.id)
    password = context.user_data.get('temp_password')
    blob_id = context.user_data.get('encrypted_data_blob')
    wallet_address = context.user_data.get('wallet_address')

    if user_response in ['yes', 'y']:
        registration_system = TelegramRegistrationSystem()
        await update.effective_chat.send_message("✅ Verification completed!")
    else:
        await update.effective_chat.send_message("✅ Registration complete! You can start using the bot.")

    context.user_data.pop('awaiting_verification_choice', None)
    context.user_data.pop('temp_password', None)

    return ConversationHandler.END

# ============= MESSAGE HANDLER FOR SPECIAL STATES =============
async def handle_special_states(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle messages for special registration states."""
    if context.user_data.get('awaiting_wallet_confirmation'):
        return await handle_wallet_confirmation(update, context)
    elif context.user_data.get('awaiting_verification_choice'):
        return await handle_verification_choice(update, context)
    else:
        await update.message.reply_text("Please use /start to begin registration.")
        return ConversationHandler.END

# ============= PASSWORD RESET (KEEP EXISTING) =============
async def forgot_password_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Start password reset process with rate limiting"""
    telegram_id = str(update.effective_user.id)

    allowed, error_msg = rate_limiter.check_rate_limit(telegram_id, "password_reset_request")
    if not allowed:
        await update.message.reply_text(f"❌ {error_msg}")
        return ConversationHandler.END

    await update.message.reply_text(
        "🔐 Password Reset\n\n"
        "Please enter the email address associated with your account:"
    )
    return PASSWORD_RESET_EMAIL

async def handle_password_reset_email(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle password reset email input with rate limiting"""
    email = update.message.text.strip().lower()
    telegram_id = str(update.effective_user.id)

    allowed, error_msg = rate_limiter.check_rate_limit(telegram_id, "password_reset_request")
    if not allowed:
        await update.message.reply_text(f"❌ {error_msg}")
        return ConversationHandler.END

    user_found = await check_email_exists(email)

    if not user_found:
        rate_limiter.check_rate_limit(telegram_id, "password_reset_request")
        await update.message.reply_text(
            "❌ No account found with this email address.\n\n"
            "Please check your email or use /start to create a new account."
        )
        return ConversationHandler.END

    try:
        otp = otp_manager.generate_otp()
        otp_id = otp_manager.save_otp(email, otp, 'password_reset')

        sending_msg = await update.message.reply_text("📧 Sending password reset code...")
        success = await otp_manager.send_otp_email(email, otp, 'password_reset')

        if success:
            context.user_data['reset_otp_id'] = otp_id
            context.user_data['reset_email'] = email
            context.user_data['reset_telegram_id'] = telegram_id

            await sending_msg.edit_text(
                f"✅ Password reset code sent to: {email}\n\n"
                f"📝 Please enter the 6-digit code you received:\n\n"
                f"⏰ The code expires in 10 minutes\n"
                f"🔒 You have 3 attempts to enter the correct code"
            )
            return PASSWORD_RESET_OTP
        else:
            rate_limiter.check_rate_limit(telegram_id, "password_reset_request")
            await sending_msg.edit_text(
                "❌ Failed to send reset code.\n\n"
                "Please check your email address and try again later."
            )
            return ConversationHandler.END

    except Exception as e:
        rate_limiter.check_rate_limit(telegram_id, "password_reset_request")
        await update.message.reply_text("❌ Error sending reset code. Please try again.")
        return ConversationHandler.END

async def handle_password_reset_otp(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle password reset OTP verification with rate limiting"""
    otp_code = update.message.text.strip()
    otp_id = context.user_data.get('reset_otp_id')
    telegram_id = context.user_data.get('reset_telegram_id')

    if not otp_id or not telegram_id:
        await update.message.reply_text("❌ Session error. Please start over with /forgot_password")
        return ConversationHandler.END

    allowed, error_msg = rate_limiter.check_rate_limit(telegram_id, "password_reset_otp")
    if not allowed:
        await update.message.reply_text(f"❌ {error_msg}")
        return ConversationHandler.END

    result = otp_manager.verify_otp(otp_id, otp_code)

    if result['valid']:
        rate_limiter.reset_attempts(telegram_id, "password_reset_request")
        rate_limiter.reset_attempts(telegram_id, "password_reset_otp")

        await update.message.reply_text(
            "✅ Code verified! Please enter your new password:\n\n"
            "🔒 Password Requirements:\n"
            "• At least 8 characters\n"
            "• Uppercase and lowercase letters\n"
            "• At least one number\n"
            "• Special characters allowed"
        )
        return NEW_PASSWORD_SETUP
    else:
        error_msg = result.get('error', 'Invalid code')
        attempts_count = rate_limiter.get_attempts_count(telegram_id, "password_reset_otp")
        remaining_attempts = 3 - attempts_count

        if 'expired' in error_msg.lower():
            await update.message.reply_text(
                "❌ Reset code has expired.\n\n"
                "Please use /forgot_password to request a new code."
            )
            return ConversationHandler.END
        else:
            if remaining_attempts > 0:
                await update.message.reply_text(
                    f"❌ {error_msg}\n\n"
                    f"Please enter the correct 6-digit code:\n"
                    f"Attempts remaining: {remaining_attempts}"
                )
                return PASSWORD_RESET_OTP
            else:
                await update.message.reply_text(
                    "❌ Too many incorrect attempts.\n\n"
                    "Please use /forgot_password to start over."
                )
                return ConversationHandler.END

async def handle_new_password_setup(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle new password setup after reset."""
    new_password = update.message.text.strip()
    try:
        await update.message.delete()
    except Exception as e:
        pass

    is_valid, error_msg = is_strong_password(new_password)
    if not is_valid:
        error_msg_sent = await update.effective_chat.send_message(
            f"❌ {error_msg}\n\nPlease enter a stronger password:"
        )
        await asyncio.sleep(3)
        try:
            await error_msg_sent.delete()
        except:
            pass
        return NEW_PASSWORD_SETUP

    email = context.user_data.get('reset_email')

    try:
        success = await update_user_password(email, new_password, context)

        if success:
            success_msg = await update.effective_chat.send_message(
                "✅ Password updated successfully!\n\n"
                "You can now use your new password with all bot commands."
            )

            context.user_data.pop('reset_otp_id', None)
            context.user_data.pop('reset_email', None)

            await asyncio.sleep(5)
            try:
                await success_msg.delete()
            except:
                pass

        else:
            error_msg = await update.effective_chat.send_message(
                "❌ Failed to update password. Please contact support."
            )
            await asyncio.sleep(5)
            try:
                await error_msg.delete()
            except:
                pass

    except Exception as e:
        error_msg = await update.effective_chat.send_message(
            "❌ Error updating password. Please try again later."
        )
        await asyncio.sleep(5)
        try:
            await error_msg.delete()
        except:
            pass

    return ConversationHandler.END

async def check_email_exists(email: str) -> bool:
    """Check if email exists using encrypted index."""
    try:
        key_manager = get_key_manager()
        email_index = LocalEncryptedEmailIndex(key_manager, os.getenv('EMAIL_INDEX_PASSWORD'))
        return email_index.email_exists(email)
    except Exception as e:
        return False

async def get_telegram_id_from_email(email: str) -> Optional[str]:
    """Get telegram_id from email using encrypted index."""
    try:
        key_manager = get_key_manager()
        email_index = LocalEncryptedEmailIndex(key_manager, os.getenv('EMAIL_INDEX_PASSWORD'))
        return email_index.get_telegram_id_by_email(email)
    except Exception as e:
        return None

async def is_email_already_registered(email: str) -> bool:
    try:
        key_manager = get_key_manager()
        email_index = LocalEncryptedEmailIndex(key_manager)
        return email_index.email_exists(email)
    except Exception as e:
        return False

async def update_user_password(email: str, new_password: str, context: ContextTypes.DEFAULT_TYPE) -> bool:
    """Update user password - WALRUS COMPATIBLE VERSION."""
    try:
        telegram_id = await get_telegram_id_from_email(email)
        if not telegram_id:
            return False

        private_key = rsa.generate_private_key(public_exponent=65537, key_size=4096)
        public_key = private_key.public_key()

        priv_pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.BestAvailableEncryption(new_password.encode())
        )

        pub_pem = public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo
        )

        key_data = {
            "telegram_id": telegram_id,
            "encrypted_private_pem": base64.b64encode(priv_pem).decode('utf-8'),
            "public_pem": pub_pem.decode('utf-8'),
            "created_at": datetime.now().isoformat(),
            "version": 2,
            "password_reset_at": datetime.now().isoformat()
        }

        key_manager = get_key_manager()
        new_blob_id = key_manager.store_encrypted_object(key_data, telegram_id, new_password)

        if not new_blob_id:
            return False

        session = await session_manager.load_user_session(telegram_id, new_password) or {}
        session.update({
            'key_blob_id': new_blob_id,
            'has_encryption_keys': True,
            'public_key': public_key,
            'encrypted_private_key': priv_pem,
            'public_pem': pub_pem.decode('utf-8'),
            'password_reset': True,
            'last_password_reset': datetime.now().isoformat()
        })

        session.pop('session_token', None)

        await session_manager.save_user_session(telegram_id, session, new_password)

        return True

    except Exception as e:
        return False

async def recover_wallet_from_walrus(self, user_id: str, password: str, blob_id: str) -> Optional[Dict[str, str]]:
    """Recover wallet from Walrus storage."""
    try:
        key_manager = get_key_manager()
        wallet_data = key_manager.retrieve_encrypted_object(blob_id, user_id, password)

        if not wallet_data:
            return None

        wallet_info = {
            'address': wallet_data['address'],
            'mnemonic': wallet_data['mnemonic'],
            'private_key': wallet_data['wallet_info']['private_key'],
            'public_key': wallet_data['wallet_info']['public_key']
        }

        return wallet_info

    except Exception as e:
        return None

async def recover_wallet_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Command to recover wallet from Walrus backup."""
    telegram_id = str(update.effective_user.id)

    password = await get_password_via_key_validation(telegram_id, context)
    session = await session_manager.load_user_session(telegram_id, password or "local_storage_fallback_password")

    if not session or not session.get('wallet_blob_id'):
        await update.message.reply_text(
            "❌ No wallet backup found.\n\n"
            "If you've lost your wallet, you'll need to:\n"
            "1. Use your 12-word recovery phrase, OR\n"
            "2. Contact support if you registered recently"
        )
        return

    await update.message.reply_text(
        "🔐 Wallet Recovery\n\n"
        "Please enter your password to recover your wallet from secure backup:"
    )

    context.user_data['recovery_mode'] = True
    context.user_data['recovery_blob_id'] = session['wallet_blob_id']
    return WALLET_RECOVERY_STATE

async def handle_wallet_recovery(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle wallet recovery password."""
    telegram_id = str(update.effective_user.id)
    password = update.message.text.strip()

    try:
        await update.message.delete()
    except:
        pass

    blob_id = context.user_data.get('recovery_blob_id')

    registration_system = TelegramRegistrationSystem()
    wallet_info = await registration_system.recover_wallet_from_walrus(
        telegram_id, password, blob_id
    )

    if wallet_info:
        await update.effective_chat.send_message(
            f"✅ Wallet Recovered Successfully!\n\n"
            f"**Wallet Address:** `{wallet_info['address']}`\n\n"
            f"Your wallet has been restored from decentralized backup."
        )

        session = await session_manager.load_user_session(telegram_id, password) or {}
        session['wallet_address'] = wallet_info['address']
        session['wallet_recovered'] = True
        await session_manager.save_user_session(telegram_id, session, password)

    else:
        await update.effective_chat.send_message(
            "❌ Recovery failed. Wrong password or corrupted backup.\n\n"
            "Please try again or use your 12-word recovery phrase."
        )

    context.user_data.clear()
    return ConversationHandler.END

async def recover_session_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Recover session for users who completed registration but lost session token."""
    telegram_id = str(update.effective_user.id)

    password = await get_password_via_key_validation(telegram_id, context)
    session = await session_manager.load_user_session(telegram_id, password or "local_storage_fallback_password")

    if not session:
        await update.message.reply_text("❌ No session found. Please use /start to register.")
        return

    if not session.get('registration_complete'):
        await update.message.reply_text("❌ Registration not complete. Please use /start.")
        return

    if session.get('session_token'):
        await update.message.reply_text("✅ You already have an active session!")
        return

    await update.message.reply_text(
        "🔐 **Session Recovery**\n\n"
        "Your registration is complete but your session token is missing.\n\n"
        "Please enter your password to recreate your session:"
    )

    context.user_data['recovering_session'] = True
    return SESSION_RECOVERY_STATE

async def handle_session_recovery(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle session recovery password - FIXED VERSION."""
    telegram_id = str(update.effective_user.id)
    password = update.message.text.strip()

    try:
        await update.message.delete()
    except:
        pass

    session = await session_manager.load_user_session(telegram_id, password or "local_storage_fallback_password")
    if not session:
        await update.effective_chat.send_message("❌ Session lost. Please use /start.")
        return ConversationHandler.END

    blob_id = session.get('key_blob_id')
    if not blob_id:
        await update.effective_chat.send_message("❌ No key backup found. Please use /start.")
        return ConversationHandler.END

    progress_msg = await update.effective_chat.send_message("🔐 Verifying password and recovering keys...")

    try:
        key_manager = get_key_manager()

        public_key, encrypted_private = await key_manager.retrieve_keys_from_walrus(
            blob_id, telegram_id, password
        )

        if public_key:
            from utils import create_user_session_with_password
            success = await create_user_session_with_password(telegram_id, password, context)

            if success:
                session['has_encryption_keys'] = True
                session['public_key'] = public_key
                session['encrypted_private_key'] = encrypted_private
                session['public_pem'] = public_key.public_bytes(
                    encoding=serialization.Encoding.PEM,
                    format=serialization.PublicFormat.SubjectPublicKeyInfo
                ).decode('utf-8')

                await session_manager.save_user_session(telegram_id, session, password)

                await progress_msg.edit_text(
                    "✅ **Session Recovered Successfully!**\n\n"
                    "Your session has been restored and your encryption keys are loaded.\n\n"
                    "You can now use all features:\n"
                    "• /new_task - Create encrypted tasks\n"
                    "• /task_history - View your tasks\n"
                    "• /portfolio - Check your wallet"
                )
            else:
                await progress_msg.edit_text("❌ Failed to create session. Please try again.")
        else:
            await progress_msg.edit_text(
                "❌ Invalid password or key retrieval failed.\n\n"
                "This could be because:\n"
                "• Wrong password\n"
                "• Key data corrupted\n"
                "• Network issue\n\n"
                "Please try again or use /forgot_password if you've forgotten your password:"
            )
            return SESSION_RECOVERY_STATE

    except Exception as e:
        await progress_msg.edit_text(
            "❌ Error during recovery. Please try again or contact support."
        )
        return SESSION_RECOVERY_STATE

    context.user_data.clear()
    return ConversationHandler.END

# ============= UTILITY FUNCTIONS =============
async def periodic_otp_cleanup():
    """Clean up expired OTPs every hour"""
    while True:
        try:
            otp_manager.cleanup_expired_otps()
            await asyncio.sleep(3600)
        except Exception as e:
            await asyncio.sleep(300)

# ============= OTHER COMMANDS (KEEP EXISTING) =============
async def security_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /security command - Display security and encryption info."""
    telegram_id = str(update.effective_user.id)
    if not await ensure_user_has_keys(telegram_id, context):
        await update.message.reply_text(
            "No encryption keys found.\n"
            "Use /start to set up encryption."
        )
        return

    password = await get_password_via_key_validation(telegram_id, context)
    session = await session_manager.load_user_session(telegram_id, password or "local_storage_fallback_password")

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

async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show all commands."""
    help_text = (
        "🤖 Tovira Bot Commands\n\n"
        "GETTING STARTED:\n"
        "/start - Create account\n"
        "/forgot_password - Reset your password\n\n"
        "/recover_session - Full recovery of your session\n\n"
        "FEATURES:\n"
        "/new_task - Create task schedule\n"
        "/portfolio - Monitor your sui wallet and assets (NFTs, kiosk....)\n"
        "/checkin - Daily +1 point\n\n"
        "REWARDS:\n"
        "/leaderboard - Check your rank and points!\n\n"
        "PROFILE:\n"
        "/change_username\n"
        "/send\n"
        "/receive\n"
        "/export_wallet\n"
        "/task_history\n\n"
        "Points are accrued for each activity done.\n\n"
        "Testnet is in phases, more features coming soon."
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

async def email_stats_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Check email index statistics."""
    try:
        email_index = LocalEncryptedEmailIndex()
        stats = email_index.get_index_stats()

        message = (
            "📊 **Email Index Statistics**\n\n"
            f"• **Total Emails:** `{stats['total_emails']}`\n"
            f"• **Storage:** `{stats.get('storage', 'local_encrypted')}`\n"
            f"• **Last Updated:** `{stats.get('last_updated', 'N/A')}`\n"
            f"• **Created:** `{stats.get('created_at', 'N/A')}`\n\n"
            "🔒 **Storage:** Local encrypted file (fast & reliable)"
        )

        await update.message.reply_text(message, parse_mode='Markdown')

    except Exception as e:
        await update.message.reply_text(f"❌ Error getting stats: {str(e)}")

async def check_my_email_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Check if current user's email is in index."""
    try:
        telegram_id = str(update.effective_user.id)

        password = await get_password_via_key_validation(telegram_id, context)
        session = await session_manager.load_user_session(telegram_id, password or "local_storage_fallback_password")

        if session and session.get('email'):
            email = session['email']
            email_index = LocalEncryptedEmailIndex()

            exists = email_index.email_exists(email)
            mapped_to = email_index.get_telegram_id_by_email(email)

            status = "✅ REGISTERED" if exists else "❌ NOT FOUND"
            mapping = "✅ CORRECT" if mapped_to == telegram_id else "❌ WRONG USER"

            await update.message.reply_text(
                f"📧 **Your Email Status**\n\n"
                f"Email: `{email}`\n"
                f"Status: {status}\n"
                f"Mapping: {mapping}\n"
                f"Storage: 🔒 Local Encrypted File"
            )
        else:
            await update.message.reply_text("❌ No email found in your session")

    except Exception as e:
        await update.message.reply_text(f"❌ Error: {str(e)}")

# ============= USERNAME MANAGEMENT =============
async def change_username_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Command to change username with HTML support"""
    telegram_id = str(update.effective_user.id)

    password = await get_password_via_key_validation(telegram_id, context)
    session = await session_manager.load_user_session(telegram_id, password or "local_storage_fallback_password")

    if not session or not session.get('registration_complete'):
        await update.message.reply_text(
            "❌ Please complete registration first with /start",
            parse_mode='HTML'
        )
        return

    current_username = session.get('username', 'Not set')
    telegram_username = update.effective_user.username

    await update.message.reply_text(
        f"👤 <b>Change Username</b>\n\n"
        f"<b>Current Username:</b> {html.escape(current_username) if current_username != 'Not set' else 'Not set'}\n"
        f"<b>Telegram Username:</b> @{html.escape(telegram_username) if telegram_username else 'Not set'}\n\n"
        "Enter your new username:\n\n"
        "💡 <b>Tips:</b>\n"
        "• 2-30 characters\n"
        "• Emojis and symbols allowed! 🎉\n"
        "• This username will appear in the leaderboard!\n\n"
        "<i>Examples: </i> <code>John_Doe 🚀</code>, <code>Alice🌟</code>, <code>Bob_The_Builder 🔨</code>",
        parse_mode='HTML'
    )

    context.user_data['changing_username'] = True
    return USERNAME_SETUP

async def handle_username_setup(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle new username input with HTML-safe validation"""
    telegram_id = str(update.effective_user.id)
    new_username = update.message.text.strip()

    if not new_username or len(new_username) < 2:
        await update.message.reply_text(
            "❌ <b>Invalid Username</b>\n\n"
            "Username must be at least 2 characters long.\n\n"
            "Please enter a valid username:",
            parse_mode='HTML'
        )
        return USERNAME_SETUP

    if len(new_username) > 30:
        await update.message.reply_text(
            "❌ <b>Username Too Long</b>\n\n"
            "Username must be 30 characters or less.\n\n"
            "Please enter a shorter username:",
            parse_mode='HTML'
        )
        return USERNAME_SETUP

    if await is_username_taken(new_username, telegram_id):
        await update.message.reply_text(
            "❌ <b>Username Already Taken</b>\n\n"
            "This username is already in use by another user.\n\n"
            "Please choose a different username:",
            parse_mode='HTML'
        )
        return USERNAME_SETUP

    password = await get_password_via_key_validation(telegram_id, context)
    session = await session_manager.load_user_session(telegram_id, password or "local_storage_fallback_password")

    if session:
        old_username = session.get('username', 'Not set')
        session['username'] = new_username
        session['username_set_at'] = datetime.now().isoformat()

        await session_manager.save_user_session(telegram_id, session, password or "local_storage_fallback_password")

        await update.message.reply_text(
            f"✅ <b>Username Updated Successfully!</b>\n\n"
            f"<b>Old Username:</b> {html.escape(old_username) if old_username != 'Not set' else 'Not set'}\n"
            f"<b>New Username:</b> {html.escape(new_username)}\n\n"
            "Your new username will appear in:\n"
            "• Leaderboard rankings\n"
            "• Profile displays\n"
            "• All future interactions",
            parse_mode='HTML'
        )

        email = session.get('email')
        if email:
            try:
                key_manager = get_key_manager()
                email_index = LocalEncryptedEmailIndex(key_manager)
            except Exception as e:
                pass

    context.user_data.pop('changing_username', None)
    return ConversationHandler.END

async def is_username_taken(username: str, current_user_id: str) -> bool:
    """Check if username is already taken by another user"""
    try:
        from secure_storage import load_and_decrypt
        sessions_dir = Path("user_sessions")

        if sessions_dir.exists():
            for session_file in sessions_dir.glob("*.enc"):
                try:
                    session = load_and_decrypt(session_file)
                    if not session or 'telegram_id' not in session:
                        continue

                    if str(session['telegram_id']) == current_user_id:
                        continue

                    existing_username = session.get('username', '')
                    if existing_username and existing_username.lower() == username.lower():
                        return True

                except Exception as e:
                    continue

        return False
    except Exception as e:
        return False

async def get_user_display_name(telegram_id: str, context: ContextTypes.DEFAULT_TYPE) -> str:
    """Get the best available display name for a user"""
    try:
        password = await get_password_via_key_validation(telegram_id, context)
        session = await session_manager.load_user_session(telegram_id, password or "local_storage_fallback_password")

        if not session:
            return f"User#{telegram_id[-4:]}"

        custom_username = session.get('username', '')
        if custom_username and custom_username not in ['User', 'Anonymous', '']:
            return custom_username

        telegram_username = session.get('telegram_username', '')
        if telegram_username:
            return telegram_username

        first_name = session.get('first_name', '')
        if first_name and first_name not in ['User', 'Anonymous']:
            return first_name

        return f"User#{telegram_id[-4:]}"

    except Exception as e:
        return f"User#{telegram_id[-4:]}"

# ============= EXPORT WALLET - DUAL MODE WITH RATE LIMITING =============
async def export_wallet_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Start wallet export — user chooses: Password (shows mnemonic) or Mnemonic (shows only address)"""
    telegram_id = str(update.effective_user.id)

    password = await get_password_via_key_validation(telegram_id, context)
    session = await session_manager.load_user_session(telegram_id, password or "local_storage_fallback_password")

    if not session or not session.get('registration_complete'):
        await update.message.reply_text("❌ Please complete registration first with /start")
        return ConversationHandler.END

    wallet_blob_id = session.get('wallet_blob_id')

    if not wallet_blob_id:
        wallet_blob_id = await find_wallet_blob_id(telegram_id, context)

    if not wallet_blob_id:
        wallet_address = session.get('wallet_address')
        if wallet_address:
            await update.message.reply_text(
                "⚠️ **Wallet Backup Not Found**\n\n"
                "Your wallet exists but backup data is missing.\n\n"
                "**Options:**\n"
                "• Use your 12-word recovery phrase in any Sui wallet\n"
                "• Contact support for recovery assistance\n\n"
                f"Your wallet address: `{wallet_address}`"
            )
            return ConversationHandler.END
        else:
            await update.message.reply_text(
                "❌ **No Wallet Found**\n\n"
                "Please complete registration with /start to create a wallet."
            )
            return ConversationHandler.END

    keyboard = [
        [InlineKeyboardButton("🔐 Use Password (Shows Mnemonic + Address)", callback_data="export_with_password")],
        [InlineKeyboardButton("📝 Use Mnemonic (Shows Only Address)", callback_data="export_with_mnemonic")],
        [InlineKeyboardButton("❌ Cancel", callback_data="export_cancel")]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)

    await update.message.reply_text(
        "💰 WALLET EXPORT MODE\n\n"
        "Choose how you want to recover your wallet:\n\n"
        "• 🔐 Use Password → Shows your 12-word mnemonic + address\n"
        "• 📝 Use Mnemonic → Shows only your wallet address (safer in public)\n\n"
        "Your data is end-to-end encrypted on Walrus — only you can access it.",
        reply_markup=reply_markup
    )

    context.user_data['wallet_blob_id'] = wallet_blob_id
    return SELECT_EXPORT_METHOD

async def find_wallet_blob_id(telegram_id: str, context: ContextTypes.DEFAULT_TYPE) -> Optional[str]:
    """Try to find wallet blob ID from various sources"""
    try:
        password = await get_password_via_key_validation(telegram_id, context)
        session = await session_manager.load_user_session(telegram_id, password or "local_storage_fallback_password")

        if not session:
            return None

        receipt_blob_id = session.get('receipt_blob_id')
        if receipt_blob_id:
            key_manager = get_key_manager()
            password = await get_active_password(telegram_id, context)
            if password:
                receipt_data = key_manager.retrieve_encrypted_object(receipt_blob_id, telegram_id, password)
                if receipt_data and 'storage' in receipt_data:
                    wallet_blob_id = receipt_data['storage'].get('wallet_blob_id')
                    if wallet_blob_id:
                        session['wallet_blob_id'] = wallet_blob_id
                        await session_manager.save_user_session(telegram_id, session, password)
                        return wallet_blob_id

        key_manager = get_key_manager()
        password = await get_active_password(telegram_id, context)
        if password:
            possible_blob_ids = [
                f"{telegram_id}_wallet",
                f"wallet_{telegram_id}",
                f"{telegram_id}_sui_wallet"
            ]

            for blob_id in possible_blob_ids:
                try:
                    wallet_data = key_manager.retrieve_encrypted_object(blob_id, telegram_id, password)
                    if wallet_data and 'mnemonic' in wallet_data:
                        session['wallet_blob_id'] = blob_id
                        await session_manager.save_user_session(telegram_id, session, password)
                        return blob_id
                except:
                    continue

        registration_system = context.application.bot_data.get('registration_system')
        if registration_system and telegram_id in registration_system.active_registrations:
            reg_data = registration_system.active_registrations[telegram_id]
            wallet_blob_id = reg_data.get('wallet_blob_id')
            if wallet_blob_id:
                session['wallet_blob_id'] = wallet_blob_id
                await session_manager.save_user_session(telegram_id, session,
                                                        password or "local_storage_fallback_password")
                return wallet_blob_id

        return None

    except Exception as e:
        return None

async def get_active_password(telegram_id: str, context: ContextTypes.DEFAULT_TYPE) -> Optional[str]:
    """Get password from active session sources"""
    try:
        registration_system = context.application.bot_data.get('registration_system')
        if registration_system and telegram_id in registration_system.active_registrations:
            password = registration_system.active_registrations[telegram_id].get('password')
            if password:
                return password

        if context.user_data and context.user_data.get('registration_password'):
            return context.user_data.get('registration_password')

        return None

    except Exception as e:
        return None

async def handle_export_choice(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle button choice"""
    query = update.callback_query
    await query.answer()

    choice = query.data

    if choice == "export_cancel":
        await query.edit_message_text("❌ Export cancelled.")
        return ConversationHandler.END

    telegram_id = str(update.effective_user.id)

    if choice == "export_with_password":
        allowed, error_msg = rate_limiter.check_rate_limit(telegram_id, "export_password")
        if not allowed:
            await query.edit_message_text(f"❌ {error_msg}")
            return ConversationHandler.END

        context.user_data['export_mode'] = 'password'
        attempts_count = rate_limiter.get_attempts_count(telegram_id, "export_password")

        await query.edit_message_text(
            "🔐 Export Using Password\n\n"
            "Enter your current bot password to reveal:\n"
            "• 12-word recovery phrase\n"
            "• Wallet address\n\n"
            f"Attempts remaining: {3 - attempts_count}\n"
            "⚠️ Message auto-deletes in 2 minutes for security."
        )
        return EXPORT_PASSWORD

    elif choice == "export_with_mnemonic":
        allowed, error_msg = rate_limiter.check_rate_limit(telegram_id, "export_mnemonic")
        if not allowed:
            await query.edit_message_text(f"❌ {error_msg}")
            return ConversationHandler.END

        context.user_data['export_mode'] = 'mnemonic'
        attempts_count = rate_limiter.get_attempts_count(telegram_id, "export_mnemonic")

        await query.edit_message_text(
            "📝 Export Using Mnemonic\n\n"
            "Enter your 12-word recovery phrase (space-separated):\n\n"
            "Only your wallet address will be shown (maximum security)\n\n"
            f"Attempts remaining: {3 - attempts_count}\n"
            "⚠️ Message auto-deletes in 2 minutes for security."
        )
        return EXPORT_MNEMONIC

async def handle_export_password(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle password input for wallet export WITH RATE LIMITING"""
    password = update.message.text.strip()
    telegram_id = str(update.effective_user.id)
    blob_id = context.user_data.get('wallet_blob_id')

    try:
        await update.message.delete()
    except Exception as e:
        pass

    if not blob_id:
        await update.effective_chat.send_message("❌ Session error. Please start over with /export_wallet")
        return ConversationHandler.END

    allowed, error_msg = rate_limiter.check_rate_limit(telegram_id, "export_password")
    if not allowed:
        await update.effective_chat.send_message(f"❌ {error_msg}")
        return ConversationHandler.END

    key_manager = get_key_manager()
    wallet_data = key_manager.retrieve_encrypted_object(blob_id, telegram_id, password)

    if not wallet_data or 'mnemonic' not in wallet_data:
        attempts_count = rate_limiter.get_attempts_count(telegram_id, "export_password")
        remaining_attempts = 3 - attempts_count

        if remaining_attempts > 0:
            error_msg = await update.effective_chat.send_message(
                f"❌ Wrong password or wallet data not found\\.\n"
                f"Attempts remaining: {remaining_attempts}\n"
                f"Try again:"
            )
            asyncio.create_task(delete_message_after_delay(error_msg, 5))
            return EXPORT_PASSWORD
        else:
            await update.effective_chat.send_message(
                "❌ Too many failed attempts\\. Account locked for 1 hour\\.\n"
                "Use mnemonic mode or try again later\\."
            )
            return ConversationHandler.END

    rate_limiter.reset_attempts(telegram_id, "export_password")

    mnemonic = wallet_data['mnemonic']
    address = wallet_data.get('address', 'Unknown')

    escaped_address = address.replace('_', '\\_').replace('*', '\\*').replace('[', '\\[').replace('`', '\\`').replace(
        '{', '\\{').replace('}', '\\}')
    escaped_mnemonic = mnemonic.replace('_', '\\_').replace('*', '\\*').replace('[', '\\[').replace('`', '\\`').replace(
        '{', '\\{').replace('}', '\\}')
    escaped_password = password.replace('_', '\\_').replace('*', '\\*').replace('[', '\\[').replace('`', '\\`').replace(
        '{', '\\{').replace('}', '\\}')

    msg_text = (
        "💰 FULL WALLET RECOVERY \\(VIA PASSWORD\\)\n\n"
        f"*Wallet Address:*\n`{escaped_address}`\n\n"
        f"*12\\-Word Recovery Phrase:*\n`{escaped_mnemonic}`\n\n"
        f"🔐 *Password Used:* ||{escaped_password}||\n\n"
        "⚠️ *SECURITY WARNING:*\n"
        "• Save this information offline\n"
        "• Never share your mnemonic\n"
        "• This message auto\\-deletes in 2 minutes"
    )

    msg = await update.effective_chat.send_message(msg_text, parse_mode='MarkdownV2')
    asyncio.create_task(delete_message_after_delay(msg, 120))

    context.user_data.clear()
    return ConversationHandler.END

async def handle_export_mnemonic(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle mnemonic input for wallet verification WITH RATE LIMITING"""
    user_input = update.message.text.strip().lower()
    telegram_id = str(update.effective_user.id)
    blob_id = context.user_data.get('wallet_blob_id')

    try:
        await update.message.delete()
    except Exception as e:
        pass

    if not blob_id:
        await update.effective_chat.send_message("❌ Session error. Please start over with /export_wallet")
        return ConversationHandler.END

    allowed, error_msg = rate_limiter.check_rate_limit(telegram_id, "export_mnemonic")
    if not allowed:
        await update.effective_chat.send_message(f"❌ {error_msg}")
        return ConversationHandler.END

    password = None
    registration_system = context.application.bot_data.get('registration_system')

    if registration_system and telegram_id in registration_system.active_registrations:
        password = registration_system.active_registrations[telegram_id].get('password')

    if not password:
        password = context.user_data.get('registration_password')

    if not password:
        password = await get_password_via_key_validation(telegram_id, context)

    if not password:
        await update.effective_chat.send_message(
            "❌ Cannot verify mnemonic. Please use password mode or ensure you have an active session.\n\n"
            "💡 *Solution*: Use password mode with your current bot password."
        )
        return ConversationHandler.END

    key_manager = get_key_manager()
    wallet_data = key_manager.retrieve_encrypted_object(blob_id, telegram_id, password)

    if not wallet_data or 'mnemonic' not in wallet_data:
        await update.effective_chat.send_message("❌ Wallet data corrupted. Please use password mode.")
        return ConversationHandler.END

    stored_mnemonic = ' '.join(wallet_data['mnemonic'].lower().split())
    user_mnemonic = ' '.join(user_input.split())

    if user_mnemonic != stored_mnemonic:
        attempts_count = rate_limiter.get_attempts_count(telegram_id, "export_mnemonic")
        remaining_attempts = 3 - attempts_count

        if remaining_attempts > 0:
            error_msg = await update.effective_chat.send_message(
                f"❌ Incorrect mnemonic.\n"
                f"Attempts remaining: {remaining_attempts}\n"
                f"Please check and try again:"
            )
            asyncio.create_task(delete_message_after_delay(error_msg, 5))
            return EXPORT_MNEMONIC
        else:
            await update.effective_chat.send_message(
                "❌ Too many failed attempts. Account locked for 1 hour.\n"
                "Use password mode or try again later."
            )
            return ConversationHandler.END

    rate_limiter.reset_attempts(telegram_id, "export_mnemonic")

    address = wallet_data.get('address', 'Unknown')
    escaped_address = address.replace('_', '\\_').replace('*', '\\*').replace('[', '\\[').replace('`', '\\`')

    msg_text = (
        "✅ WALLET VERIFIED \\(MNEMONIC MODE\\)\n\n"
        f"*Wallet Address:*\n`{escaped_address}`\n\n"
        "🔐 Mnemonic verified successfully\\!\n"
        "Only address shown for maximum security\\.\n\n"
        "⚠️ This message auto\\-deletes in 2 minutes"
    )

    msg = await update.effective_chat.send_message(msg_text, parse_mode='MarkdownV2')
    asyncio.create_task(delete_message_after_delay(msg, 120))

    context.user_data.clear()
    return ConversationHandler.END

async def cancel_export(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Cancel export conversation - MATCHES YOUR cancel PATTERN"""
    await update.message.reply_text("❌ Wallet export cancelled.")
    context.user_data.clear()
    return ConversationHandler.END

async def periodic_rate_limit_cleanup(context: ContextTypes.DEFAULT_TYPE):
    """Clean up expired rate limit entries every hour"""
    try:
        rate_limiter.cleanup_expired()
    except Exception as e:
        pass

async def recover_wallet_backup_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Command to help users recover missing wallet backup"""
    telegram_id = str(update.effective_user.id)

    password = await get_password_via_key_validation(telegram_id, context)
    session = await session_manager.load_user_session(telegram_id, password or "local_storage_fallback_password")

    if not session:
        await update.message.reply_text("❌ No session found. Please use /start first.")
        return

    wallet_blob_id = await find_wallet_blob_id(telegram_id, context)

    if wallet_blob_id:
        await update.message.reply_text(
            "✅ **Wallet Backup Restored!**\n\n"
            "Your wallet backup has been found and restored.\n"
            "You can now use /export_wallet normally."
        )
    else:
        wallet_address = session.get('wallet_address')
        if wallet_address:
            await update.message.reply_text(
                "⚠️ **Wallet Backup Not Found**\n\n"
                "We couldn't find your wallet backup data, but your wallet address is:\n\n"
                f"`{wallet_address}`\n\n"
                "**Recovery Options:**\n"
                "1. If you have your 12-word phrase, use it in any Sui wallet\n"
                "2. If you remember your password, try /export_wallet again\n"
                "3. Contact support with your wallet address for assistance"
            )
        else:
            await update.message.reply_text(
                "❌ **No Wallet Found**\n\n"
                "Please complete registration with /start to create a new wallet."
            )

async def wallet_debug_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Debug command to check wallet status"""
    telegram_id = str(update.effective_user.id)

    password = await get_password_via_key_validation(telegram_id, context)
    session = await session_manager.load_user_session(telegram_id, password or "local_storage_fallback_password")

    if not session:
        await update.message.reply_text("❌ No session found")
        return

    debug_info = f"🔍 **Wallet Debug Info**\n\n"
    debug_info += f"✅ **Registration Complete:** {session.get('registration_complete', 'NO')}\n"
    debug_info += f"✅ **Wallet Address:** {session.get('wallet_address', 'NOT SET')}\n"
    debug_info += f"✅ **Wallet Blob ID:** {session.get('wallet_blob_id', 'NOT SET')}\n"
    debug_info += f"✅ **Has Encryption Keys:** {session.get('has_encryption_keys', 'NO')}\n"
    debug_info += f"✅ **Profile ID:** {session.get('profile_id', 'NOT SET')}\n"

    if session.get('wallet_address') and not session.get('wallet_blob_id'):
        debug_info += f"\n⚠️ **ISSUE:** Wallet address exists but no backup found!\n"
        debug_info += f"💡 **Solution:** The wallet wasn't properly backed up during registration.\n"

    await update.message.reply_text(debug_info, parse_mode='Markdown')

async def diagnostic_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Comprehensive system diagnostic command"""
    telegram_id = str(update.effective_user.id)

    diagnostic_text = "🔍 **SYSTEM DIAGNOSTIC REPORT**\n\n"

    try:
        diagnostic_text += "**📱 USER SESSION:**\n"
        password = await get_password_via_key_validation(telegram_id, context)
        session = await session_manager.load_user_session(telegram_id, password or "local_storage_fallback_password")

        if session:
            diagnostic_text += "✅ Session Found\n"
            diagnostic_text += f"   • Registration: {'✅ COMPLETE' if session.get('registration_complete') else '❌ INCOMPLETE'}\n"
            diagnostic_text += f"   • Profile ID: {session.get('profile_id', '❌ MISSING')}\n"
            diagnostic_text += f"   • Wallet: {session.get('wallet_address', '❌ MISSING')}\n"
            diagnostic_text += f"   • Keys: {'✅ LOADED' if session.get('has_encryption_keys') else '❌ MISSING'}\n"
            diagnostic_text += f"   • Session Token: {'✅ ACTIVE' if session.get('session_token') else '❌ MISSING'}\n"
            diagnostic_text += f"   • Points: {session.get('points', 0)} ⭐\n"
        else:
            diagnostic_text += "❌ No Session Found\n"

        diagnostic_text += "\n**🔗 CONNECTIVITY:**\n"

        try:
            walrus = get_walrus_client()
            diagnostic_text += "✅ Walrus: CONNECTED\n"
        except Exception as e:
            diagnostic_text += f"❌ Walrus: OFFLINE - {str(e)[:50]}...\n"

        try:
            sui = get_sui_client()
            import os
            REGISTRY_ID = os.getenv('COPILOT_REGISTRY_ID')
            if REGISTRY_ID:
                result = sui.client.get_object(REGISTRY_ID)
                diagnostic_text += "✅ Sui: CONNECTED & REGISTRY ACCESSIBLE\n"
            else:
                diagnostic_text += "⚠️ Sui: CONNECTED (No Registry ID)\n"
        except Exception as e:
            diagnostic_text += f"❌ Sui: OFFLINE - {str(e)[:50]}...\n"

        try:
            key_mgr = get_key_manager()
            diagnostic_text += "✅ Key Manager: OPERATIONAL\n"
        except Exception as e:
            diagnostic_text += f"❌ Key Manager: FAILED - {str(e)[:50]}...\n"

        diagnostic_text += "\n**📊 BOT DATA:**\n"

        registration_system = context.application.bot_data.get('registration_system')
        if registration_system:
            active_reg_count = len(registration_system.active_registrations)
            diagnostic_text += f"✅ Active Registrations: {active_reg_count}\n"
        else:
            diagnostic_text += "❌ Registration System: NOT INITIALIZED\n"

        import os
        storage_paths = [
            'user_sessions', 'user_wallets', 'registration_receipts',
            'user_timezones', 'logs'
        ]

        diagnostic_text += "\n**💾 LOCAL STORAGE:**\n"
        for path in storage_paths:
            if os.path.exists(path):
                file_count = len([f for f in os.listdir(path) if os.path.isfile(os.path.join(path, f))])
                diagnostic_text += f"✅ {path}: {file_count} files\n"
            else:
                diagnostic_text += f"❌ {path}: MISSING\n"

        diagnostic_text += "\n**⚙️ ENVIRONMENT:**\n"
        required_env_vars = [
            'TELEGRAM_BOT_TOKEN', 'COPILOT_REGISTRY_ID',
            'ADMIN_TELEGRAM_IDS', 'WHITELIST_BLOB_ID'
        ]

        for var in required_env_vars:
            value = os.getenv(var)
            if value:
                display_value = "SET" if var == 'TELEGRAM_BOT_TOKEN' else value[:20] + "..." if len(
                    value) > 20 else value
                diagnostic_text += f"✅ {var}: {display_value}\n"
            else:
                diagnostic_text += f"❌ {var}: NOT SET\n"

        issues = []
        solutions = []

        if session and session.get('registration_complete') and not session.get('session_token'):
            issues.append("Missing session token")
            solutions.append("Use `/recover_session` to fix")

        if session and not session.get('has_encryption_keys'):
            issues.append("Encryption keys missing")
            solutions.append("Use `/start` to regenerate keys")

        if session and session.get('profile_id') == 'local_registration':
            issues.append("Blockchain registration failed")
            solutions.append("Features limited to local mode")

        if issues:
            diagnostic_text += "\n**🚨 DETECTED ISSUES:**\n"
            for issue in issues:
                diagnostic_text += f"• {issue}\n"

            diagnostic_text += "\n**💡 SOLUTIONS:**\n"
            for solution in solutions:
                diagnostic_text += f"• {solution}\n"
        else:
            diagnostic_text += "\n**🎉 NO CRITICAL ISSUES DETECTED**\n"

        diagnostic_text += f"\n_Report generated at {datetime.now().strftime('%Y-%m-%d %H:%M:%S UTC')}_"

    except Exception as e:
        diagnostic_text = f"❌ **DIAGNOSTIC FAILED**\n\nError: {str(e)}"

    await update.message.reply_text(diagnostic_text, parse_mode='Markdown')

# ============= CONVERSATION HANDLERS =============

signup_handler = ConversationHandler(
    entry_points=[
        CommandHandler("start", start_command)
    ],
    states={
        EMAIL_VERIFICATION: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, handle_email_verification)
        ],
        OTP_VERIFICATION: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, handle_otp_verification)
        ],
        USERNAME_SETUP: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, handle_registration_username),
            CallbackQueryHandler(handle_username_choice, pattern="^use_telegram_username:"),
            CallbackQueryHandler(handle_username_choice, pattern="^choose_custom_username$")
        ],
        SET_PASSWORD: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, handle_password_setup)
        ],
        CONFIRM_PASSWORD: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, handle_password_confirmation_with_wallet)
        ],
    },
    fallbacks=[CommandHandler('cancel', cancel)],
    per_message=False
)

session_recovery_conv_handler = ConversationHandler(
    entry_points=[
        CommandHandler("recover_session", recover_session_command),
        CommandHandler("fix_me", recover_session_command),
        CommandHandler("recover", recover_session_command)
    ],
    states={
        SESSION_RECOVERY_STATE: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, handle_session_recovery)
        ],
    },
    fallbacks=[
        CommandHandler('cancel', cancel),
        CommandHandler('start', start_command)
    ],
    per_message=False,
    name="session_recovery"
)

username_conv_handler = ConversationHandler(
    entry_points=[CommandHandler("change_username", change_username_command)],
    states={
        USERNAME_SETUP: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, handle_username_setup)
        ],
    },
    fallbacks=[CommandHandler("cancel", cancel)],
    per_message=False
)

registration_username_handler = ConversationHandler(
    entry_points=[],
    states={
        USERNAME_SETUP: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, handle_registration_username),
            CallbackQueryHandler(handle_username_choice, pattern="^(use_telegram_username|choose_custom_username)")
        ],
    },
    fallbacks=[],
    per_message=False,
    name="registration_username"
)

password_reset_handler = ConversationHandler(
    entry_points=[
        CommandHandler("forgot_password", forgot_password_command)
    ],
    states={
        PASSWORD_RESET_EMAIL: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, handle_password_reset_email)
        ],
        PASSWORD_RESET_OTP: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, handle_password_reset_otp)
        ],
        NEW_PASSWORD_SETUP: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, handle_new_password_setup)
        ],
    },
    fallbacks=[CommandHandler('cancel', cancel)],
    per_message=False
)

session_recovery_handler = ConversationHandler(
    entry_points=[CommandHandler("recover_session", recover_session_command)],
    states={
        SESSION_RECOVERY_STATE: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, handle_session_recovery)
        ],
    },
    fallbacks=[CommandHandler('cancel', cancel)]
)

def setup_export_wallet_handler(application):
    """Setup the export wallet conversation handler"""
    export_conv_handler = ConversationHandler(
        entry_points=[CommandHandler("export_wallet", export_wallet_command)],
        states={
            SELECT_EXPORT_METHOD: [
                CallbackQueryHandler(handle_export_choice, pattern="^export_")
            ],
            EXPORT_PASSWORD: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, handle_export_password)
            ],
            EXPORT_MNEMONIC: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, handle_export_mnemonic)
            ],
        },
        fallbacks=[
            CommandHandler("cancel", cancel_export),
            CommandHandler("export_wallet", export_wallet_command)
        ],
        per_message=False
    )

    application.add_handler(export_conv_handler)

# ============= ERROR HANDLER =============
async def error_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle errors and log them to file."""
    try:
        # Get user ID if available
        user_id = update.effective_user.id if update and update.effective_user else None
        
        # Log error to file with full context
        log_error_to_file(
            error=context.error,
            context_info="telegram_bot_error_handler",
            user_id=user_id,
            update=update
        )
        
        # Send user-friendly message
        if update and update.effective_message:
            error_msg = handle_error(context.error, "telegram_bot")
            await update.effective_chat.send_message(error_msg)
            
    except Exception as e:
        # If error handler itself fails, log that too
        bot_error_logger.error(f"Error in error_handler: {str(e)}\n{traceback.format_exc()}")

# ============= HEALTH CHECK SERVER FOR RENDER =============
class HealthCheckHandler(BaseHTTPRequestHandler):
    """Simple HTTP handler for Render health checks"""
    
    def do_GET(self):
        """Handle GET requests"""
        if self.path == '/health' or self.path == '/':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            response = {
                'status': 'healthy',
                'service': 'Tovira Telegram Bot',
                'timestamp': datetime.now(pytz.UTC).isoformat()
            }
            self.wfile.write(json.dumps(response).encode())
        else:
            self.send_response(404)
            self.end_headers()
    
    def log_message(self, format, *args):
        """Suppress default logging to avoid cluttering logs"""
        pass

def start_health_server(port=10000):
    """Start HTTP health check server in background thread"""
    try:
        server = HTTPServer(('0.0.0.0', port), HealthCheckHandler)
        print(f"✅ Health check server running on port {port}")
        server.serve_forever()
    except Exception as e:
        print(f"⚠️ Health server failed to start: {e}")

# ============= MAIN =============
def main():
    """Start the bot."""
    # Log bot startup
    bot_error_logger.info(f"=== BOT STARTING at {datetime.now(pytz.UTC).isoformat()} ===")
    bot_error_logger.info(f"Error logs will be saved to: {error_log_file}")
    print(f"📝 Error logging enabled: {error_log_file}")
    
    # Start health check server for Render deployment
    port = int(os.getenv('PORT', 10000))
    health_thread = Thread(target=start_health_server, args=(port,), daemon=True)
    health_thread.start()
    
    token = os.getenv('TELEGRAM_BOT_TOKEN')
    if not token:
        print("❌ Set TELEGRAM_BOT_TOKEN in .env")
        return
    application = Application.builder().token(token).build()

    init_db()

    application.add_handler(signup_handler)

    application.add_handler(ConversationHandler(
        entry_points=[],
        states={
            OTP_VERIFICATION: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, handle_otp_verification)
            ],
            ConversationHandler.END: [
                MessageHandler(filters.TEXT & ~filters.COMMAND & filters.Regex(r'(?i)^yes$'),
                               handle_wallet_confirmation)
            ],
        },
        fallbacks=[],
        per_message=False,
        name="otp_wallet_final_fix"
    ))
    application.add_handler(password_reset_handler)
    application.add_handler(CommandHandler("recover", lambda update, context:
    asyncio.create_task(recover_all_users_from_sessions(context))))

    application.add_handler(task_conv_handler)
    application.add_handler(setup_callback_handler)
    application.add_handler(task_completion_handler)
    application.add_handler(session_recovery_conv_handler)
    application.add_handler(CommandHandler("timezone", timezone_command))
    application.add_handler(CommandHandler("task_history", TaskManager.task_history_command))
    application.add_handler(CommandHandler("recover_wallet", recover_wallet_backup_command))
    application.add_handler(
        MessageHandler(filters.Regex(r"^/complete_[a-zA-Z0-9]{10,}$"), TaskManager.complete_dynamic_task))

    application.add_handler(CommandHandler("help", help_command))
    application.add_handler(CommandHandler("security", security_command))
    application.add_handler(CommandHandler("recover_wallet", recover_wallet_command))
    application.add_handler(checkin_handler)
    application.add_handler(checkin_status_handler)
    application.add_handler(check_my_profile_handler)
    application.add_handler(leaderboard_handler)
    application.add_handler(refresh_leaderboard_button_handler)
    application.add_handler(portfolio_handler)
    application.add_error_handler(error_handler)
    application.add_handler(quick_checkin_button_handler)
    application.add_handler(username_conv_handler)
    application.add_handler(registration_username_handler)
    application.add_handler(auth_conv_handler)
    application.add_handler(session_recovery_handler)
    application.add_handler(timezone_callback_handler)
    application.add_handler(CommandHandler("diagnostic", diagnostic_command))
    setup_export_wallet_handler(application)
    application.add_handler(CommandHandler("wallet_debug", wallet_debug_command))
    application.add_handler(CommandHandler("email_stats", email_stats_command))
    application.add_handler(CommandHandler("check_my_email", check_my_email_command))

    application.job_queue.run_repeating(
        lambda context: asyncio.create_task(periodic_otp_cleanup()),
        interval=3600,
        first=10
    )

    application.job_queue.run_repeating(
        lambda context: asyncio.create_task(periodic_rate_limit_cleanup(context)),
        interval=3600,
        first=10
    )

    application.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == '__main__':
    main()