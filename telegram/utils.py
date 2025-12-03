"""
Utility functions for Tovira Telegram Bot — FINAL BULLETPROOF VERSION
"""
import os
import re
import json
from pathlib import Path
from datetime import datetime
from typing import Dict, Optional, Tuple, Any
import pytz
from telegram.ext import ContextTypes
from parsedatetime import Calendar
from walrus_client_change import WalrusClient, UserKeyManager
from suiclient_change import CopilotSuiClient
from secure_storage import load_and_decrypt, encrypt_and_save
from secure_storage import encrypt_data, decrypt_data
from cryptography.hazmat.primitives import hashes, serialization
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ContextTypes, CommandHandler, MessageHandler,
    CallbackQueryHandler, ConversationHandler, filters, Application
)

user_sessions = {}
AUTHENTICATION_STATE = 100

# Singleton clients
_walrus_client = None
_key_manager = None
_sui_client = None
walrus = WalrusClient()


def get_walrus_client() -> WalrusClient:
    global _walrus_client
    if _walrus_client is None:
        _walrus_client = WalrusClient()
    return _walrus_client


def get_key_manager() -> UserKeyManager:
    global _key_manager
    if _key_manager is None:
        _key_manager = UserKeyManager()
    return _key_manager


def get_sui_client() -> CopilotSuiClient:
    global _sui_client
    if _sui_client is None:
        _sui_client = CopilotSuiClient()
    return _sui_client


class SessionManager:
    def __init__(self):
        self.key_manager = get_key_manager()

    # In your utils.py, ensure save_user_session has this structure:
    async def save_user_session(self, telegram_id: str, session_data: dict, password: str) -> bool:
        """Save session with comprehensive error handling"""
        try:
            # Add metadata
            session_data['last_updated'] = datetime.now(pytz.UTC).isoformat()
            session_data['telegram_id'] = str(telegram_id)

            # Try Walrus first
            if password not in ["password_not_available_use_local", "local_storage_fallback_password"]:
                try:
                    blob_id = f"{telegram_id}_session"
                    success = self.key_manager.store_encrypted_object(session_data, str(telegram_id), password)
                    if success:
                        # Also cache locally
                        local_path = Path(f"user_sessions/{telegram_id}.json.enc")
                        local_path.parent.mkdir(exist_ok=True)
                        encrypt_and_save(session_data, local_path)
                        return True
                except Exception:
                    pass

            # Fallback to local storage
            try:
                local_path = Path(f"user_sessions/{telegram_id}.json.enc")
                local_path.parent.mkdir(exist_ok=True)
                encrypt_and_save(session_data, local_path)
                return True
            except Exception:
                return False

        except Exception:
            return False

    async def load_user_session(self, telegram_id: str, password: str) -> dict:
        """Load session from Walrus with local fallback"""
        try:
            # Try local first (fast)
            local_path = Path(f"user_sessions/{telegram_id}.json.enc")
            if local_path.exists():
                session_data = load_and_decrypt(local_path)
                if session_data and isinstance(session_data, dict) and session_data.get('telegram_id') == str(
                        telegram_id):
                    return session_data

            # If password indicates local storage only, return empty
            if password in ["password_not_available_use_local", "local_storage_fallback_password"]:
                return {}

            # Fallback to Walrus
            blob_id = f"{telegram_id}_session"
            session_data = self.key_manager.retrieve_encrypted_object(blob_id, str(telegram_id), password)

            if session_data:
                # Cache locally
                local_path.parent.mkdir(exist_ok=True)
                encrypt_and_save(session_data, local_path)
                return session_data

            return {}
        except Exception:
            return {}

    async def clear_user_session(self, telegram_id: str) -> bool:
        """Clear both Walrus and local sessions"""
        try:
            # Clear local session
            local_path = Path(f"user_sessions/{telegram_id}.json.enc")
            if local_path.exists():
                local_path.unlink()

            # Note: Walrus session will remain but will be inaccessible without password
            return True
        except Exception:
            return False


# Initialize session manager
session_manager = SessionManager()


# ============= VALIDATION =============

async def authenticate_user(update: Update, context: ContextTypes.DEFAULT_TYPE,
                            operation: str = "this operation") -> bool:
    """Authenticate user with password for sensitive operations."""
    telegram_id = str(update.effective_user.id)

    # Check if we have valid session
    password = await get_password_via_key_validation(telegram_id, context)
    session = await session_manager.load_user_session(telegram_id, password or "local_storage_fallback_password")

    if session and session.get('has_encryption_keys'):
        return True

    # Ask for password
    await update.message.reply_text(
        f"🔐 Authentication Required\n\n"
        f"Please enter your password to {operation}:\n\n"
        f"⏰ Your password will be kept secure and encrypted."
    )

    context.user_data['awaiting_authentication'] = True
    context.user_data['auth_operation'] = operation
    return False


async def handle_authentication(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle password authentication."""
    if not context.user_data.get('awaiting_authentication'):
        return ConversationHandler.END

    telegram_id = str(update.effective_user.id)
    password = update.message.text.strip()

    try:
        # Delete password message for security
        await update.message.delete()
    except:
        pass

    # Try to load keys with this password
    session = await session_manager.load_user_session(telegram_id, password)
    blob_id = session.get('key_blob_id')

    if not blob_id:
        await update.effective_chat.send_message("❌ No keys found. Please use /start to register.")
        context.user_data.clear()
        return ConversationHandler.END

    key_manager = get_key_manager()
    public_key, encrypted_private = await key_manager.retrieve_keys_from_walrus(
        blob_id, telegram_id, password
    )

    if public_key:
        # Success! Create session and proceed
        await create_user_session_with_password(telegram_id, password, context)

        # Update session with keys
        session['has_encryption_keys'] = True
        session['public_key'] = public_key
        session['encrypted_private_key'] = encrypted_private
        await session_manager.save_user_session(telegram_id, session, password)

        operation = context.user_data.get('auth_operation', 'continue')
        await update.effective_chat.send_message(f"✅ Authentication successful! You can now {operation}.")

        context.user_data.clear()
        return ConversationHandler.END
    else:
        await update.effective_chat.send_message(
            "❌ Invalid password. Please try again:\n\n"
            "Enter your password:"
        )
        return AUTHENTICATION_STATE


async def ensure_user_has_keys(telegram_id: str, context: ContextTypes.DEFAULT_TYPE) -> bool:
    """Ensure user has encryption keys - FIXED FOR JSON SERIALIZATION."""
    if not context:
        return False
    password = await get_password_via_key_validation(telegram_id, context)
    session = await session_manager.load_user_session(telegram_id, password or "local_storage_fallback_password")

    if not session:
        return False

    # ✅ Check if keys are already loaded (using public_pem instead of public_key object)
    if session.get('has_encryption_keys') and session.get('public_pem'):
        return True

    # ✅ Check if we have the necessary data to load keys
    blob_id = session.get('key_blob_id')
    session_token = session.get('session_token')

    if not blob_id:
        return False

    if not session_token:
        return False

    # ✅ Try to load keys from Walrus
    try:
        from secure_storage import validate_session_token
        token_result = validate_session_token(session_token)

        if not token_result:
            return False

        user_id, password = token_result
        if user_id != str(telegram_id):
            return False

        key_manager = get_key_manager()

        # ✅ Try to retrieve keys
        public_key, encrypted_private = await key_manager.retrieve_keys_from_walrus(
            blob_id, str(telegram_id), password
        )

        if public_key:
            # ✅ Success! Update session with JSON-serializable data only
            session.update({
                'has_encryption_keys': True,
                'public_pem': public_key.public_bytes(
                    encoding=serialization.Encoding.PEM,
                    format=serialization.PublicFormat.SubjectPublicKeyInfo
                ).decode('utf-8')
            })
            await session_manager.save_user_session(telegram_id, session, password)
            return True
        else:
            return False

    except Exception:
        return False


async def create_user_session_with_password(telegram_id: str, password: str,
                                            context: ContextTypes.DEFAULT_TYPE) -> bool:
    """Create a secure session with password for key retrieval - FIXED VERSION."""
    try:
        from secure_storage import create_session_token

        # Load existing session or create new one
        existing_session = await session_manager.load_user_session(telegram_id,
                                                                   password or "local_storage_fallback_password") or {}

        # Create session token (encrypted password valid for 1 hour)
        session_token = create_session_token(str(telegram_id), password)
        if not session_token:
            return False

        # Update session with token
        existing_session['session_token'] = session_token
        existing_session['last_login'] = datetime.now(pytz.UTC).isoformat()

        # ✅ CRITICAL: Save the session immediately
        await session_manager.save_user_session(telegram_id, existing_session, password)

        # ✅ Verify it was saved
        verified_session = await session_manager.load_user_session(telegram_id, password)
        if verified_session and verified_session.get('session_token') == session_token:
            return True
        else:
            return False

    except Exception:
        return False


async def recover_all_users_from_sessions(context: ContextTypes.DEFAULT_TYPE = None):
    """Run once — restores every user's encryption keys from their session backup"""
    session_dir = Path("./user_sessions")
    if not session_dir.exists():
        return

    recovered = 0
    for session_file in session_dir.glob("*.json.enc"):
        try:
            session_data = load_and_decrypt(session_file)
            if not session_data:
                continue

            telegram_id = session_file.stem  # filename without extension
            if not session_data.get('registration_complete'):
                continue

            saved_password = session_data.get('saved_password')
            if not saved_password:
                continue

            # THIS LINE REGENERATES THE MISSING KEY FILE
            public_key, _ = get_key_manager().create_user_keys(telegram_id, saved_password)

            recovered += 1

        except Exception:
            pass

    final_msg = f"RECOVERY COMPLETE — {recovered} users restored"
    return final_msg


async def create_user_keys(telegram_id: str, password: str, context: ContextTypes.DEFAULT_TYPE) -> bool:
    try:
        public_key_str, encrypted_private = get_key_manager().create_user_keys(telegram_id, password)
        context.user_data['public_key'] = public_key_str.encode('utf-8')
        context.user_data['has_encryption_keys'] = True
        return True
    except Exception:
        return False


async def get_user_private_key(telegram_id: str, password: str) -> Optional[bytes]:
    try:
        return get_key_manager().get_user_private_key(telegram_id, password)
    except Exception:
        return None


def is_strong_password(password: str) -> Tuple[bool, str]:
    if len(password) < 8:
        return False, "Password must be at least 8 characters"
    if not re.search(r'[A-Z]', password):
        return False, "Password must contain uppercase letter"
    if not re.search(r'[a-z]', password):
        return False, "Password must contain lowercase letter"
    if not re.search(r'\d', password):
        return False, "Password must contain a number"
    return True, ""


def is_valid_email(email: str) -> bool:
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email))


def is_valid_telegram_id(telegram_id: str) -> bool:
    return telegram_id.isdigit() and len(telegram_id) > 0


def is_valid_referral_code(code: str) -> bool:
    return len(code) == 8 and code.isalnum()


def is_valid_admin_code(code: str) -> bool:
    return code.startswith('ADM-') and len(code) == 17


def is_admin(telegram_id: str) -> bool:
    admin_ids = set(os.getenv('ADMIN_TELEGRAM_IDS', '').split(','))
    return str(telegram_id) in admin_ids


# ============= ENCRYPTED SESSION MANAGEMENT (UPDATED WITH SESSIONMANAGER) =============

async def save_user_session(telegram_id: str, session_data: Dict[str, Any],
                            context: ContextTypes.DEFAULT_TYPE = None) -> bool:
    """
    Save user session data - UPDATED TO USE SESSIONMANAGER.

    Args:
        telegram_id: User's Telegram ID
        session_data: Session dictionary to save
        context: Bot context (optional)

    Returns:
        True if successful, False otherwise
    """
    password = await get_password_via_key_validation(telegram_id, context)
    return await session_manager.save_user_session(telegram_id, session_data,
                                                   password or "local_storage_fallback_password")


async def load_user_session(user_id: str, context: ContextTypes.DEFAULT_TYPE) -> Optional[Dict[str, Any]]:
    """
    Load session — priority: encrypted file → context → reconstruct
    """
    try:
        password = await get_password_via_key_validation(user_id, context)
        # Use SessionManager to load session
        session = await session_manager.load_user_session(user_id, password or "local_storage_fallback_password")

        if session and isinstance(session, dict):
            # Update context with loaded session
            context.user_data['session'] = session
            return session

        # Reconstruct minimal session if none exists
        session = {'telegram_id': user_id, 'points': 0}
        profile_id = find_profile_id_from_receipt(user_id)
        if profile_id:
            session['profile_id'] = profile_id

        context.user_data['session'] = session
        await session_manager.save_user_session(user_id, session, password or "local_storage_fallback_password")
        return session

    except Exception:
        return None


def find_profile_id_from_receipt(telegram_id: str) -> Optional[str]:
    try:
        receipts_dir = Path('./registration_receipts')
        if not receipts_dir.exists():
            return None

        encrypted_receipts = list(receipts_dir.glob(f"{telegram_id}_*.enc"))
        if not encrypted_receipts:
            return None

        encrypted_receipts.sort(key=lambda x: x.stat().st_mtime, reverse=True)
        for receipt_file in encrypted_receipts:
            try:
                receipt = load_and_decrypt(receipt_file)
                if not receipt:
                    continue
                profile_id = (
                        receipt.get('profile_id') or
                        receipt.get('blockchain', {}).get('profile_id') or
                        receipt.get('registration_result', {}).get('profile_id')
                )
                if profile_id and str(profile_id).lower() not in ['none', 'local_registration', '']:
                    return str(profile_id)
            except Exception:
                pass
        return None
    except Exception:
        return None


def clear_user_session(telegram_id: str) -> bool:
    """Clear user session using SessionManager"""
    return session_manager.clear_user_session(telegram_id)


# ============= TIME & DATE =============
def parse_natural_language_date(text: str) -> Optional[datetime]:
    try:
        cal = Calendar()
        time_struct, parse_status = cal.parse(text)
        if parse_status:
            return datetime(*time_struct[:6])
        return None
    except Exception:
        return None


def format_date_for_display(dt: datetime) -> str:
    return dt.strftime('%Y-%m-%d %H:%M')


def get_current_utc() -> datetime:
    return datetime.now(pytz.UTC)


async def save_user_timezone(telegram_id: str, timezone_str: str, context: ContextTypes.DEFAULT_TYPE) -> bool:
    """Save user's timezone preference - UPDATED WITH SESSIONMANAGER."""
    try:
        # Load existing session
        password = await get_password_via_key_validation(telegram_id, context)
        session = await session_manager.load_user_session(telegram_id, password or "local_storage_fallback_password")
        if not session:
            session = {}

        # Update timezone in session
        session['timezone'] = timezone_str
        session['timezone_set_at'] = datetime.now(pytz.UTC).isoformat()

        # ✅ Use SessionManager to save
        success = await session_manager.save_user_session(telegram_id, session,
                                                          password or "local_storage_fallback_password")

        if success:
            return True
        else:
            return False

    except Exception:
        return False


async def load_user_timezone(telegram_id: str, context: ContextTypes.DEFAULT_TYPE) -> str:
    try:
        if context.user_data.get('user_timezone'):
            return context.user_data['user_timezone']

        # Try to load from session first
        password = await get_password_via_key_validation(telegram_id, context)
        session = await session_manager.load_user_session(telegram_id, password or "local_storage_fallback_password")
        if session and session.get('timezone') in pytz.all_timezones:
            tz = session['timezone']
            context.user_data['user_timezone'] = tz
            return tz

        # Fallback to local timezone file
        tz_file = Path('./user_timezones') / f"{telegram_id}.txt"
        if tz_file.exists():
            tz = tz_file.read_text().strip()
            if tz in pytz.all_timezones:
                context.user_data['user_timezone'] = tz
                return tz

        return "UTC"
    except Exception:
        return "UTC"


# ============= REST (UNCHANGED) =============
def validate_encryption_keys(public_key: Optional[bytes], private_key: Optional[bytes]) -> bool:
    return public_key is not None and private_key is not None


def generate_user_identifier(telegram_id: str, username: str) -> str:
    return f"{telegram_id}_{username}_{int(datetime.now().timestamp())}"


def format_profile_data(profile_data: Dict) -> str:
    if not profile_data:
        return "No profile data available"
    lines = []
    for key in ['username', 'email', 'telegram_id', 'timezone']:
        if key in profile_data and profile_data[key]:
            lines.append(f"{key.capitalize()}: {profile_data[key]}")
    return "\n".join(lines) if lines else "No profile data"


def format_task_data(task_data: Dict) -> str:
    if not task_data:
        return "No task data available"
    lines = []
    if 'task_name' in task_data:
        lines.append(f"{task_data['task_name']}")
    if 'description' in task_data:
        lines.append(f"{task_data['description']}")
    if 'due_date' in task_data:
        lines.append(f"Due: {task_data['due_date']}")
    if 'status' in task_data:
        status = "Completed" if task_data['status'] == 'completed' else "Pending"
        lines.append(f"{status}")
    return "\n".join(lines)


async def get_password_via_key_validation(telegram_id: str, context: ContextTypes.DEFAULT_TYPE) -> Optional[str]:
    """
    Try to get password from active session - FIXED VERSION (no recursion)
    """
    try:
        # Method 1: Check active registration (user just registered)
        if (context and hasattr(context, 'application') and
            context.application and context.application.bot_data):
            registration_system = context.application.bot_data.get('registration_system')
            if registration_system and telegram_id in registration_system.active_registrations:
                password = registration_system.active_registrations[telegram_id].get('password')
                if password:
                    return password

        # Method 2: Check context user_data
        if context and context.user_data and context.user_data.get('password'):
            password = context.user_data.get('password')
            return password

        # Method 3: Check session token exists (but don't try to extract password)
        try:
            # Load session with fallback password to check if session exists
            session = await session_manager.load_user_session(
                telegram_id,
                "local_storage_fallback_password"
            )
            if session and session.get('session_token'):
                # Password is not retrievable from session token (secure by design)
                return None
        except Exception:
            pass

        return None

    except Exception:
        return None


class RegistrationError(Exception): pass


class EncryptionError(Exception): pass


class BlockchainError(Exception): pass


def handle_error(error: Exception, context: str = "") -> str:
    if isinstance(error, RegistrationError):
        return f"Registration error: {str(error)}"
    elif isinstance(error, EncryptionError):
        return f"Encryption error: {str(error)}"
    elif isinstance(error, BlockchainError):
        return f"Blockchain error: {str(error)}"
    return "An unexpected error occurred. Please try again."


async def recover_user_data_from_walrus(telegram_id: str, password: str, context: ContextTypes.DEFAULT_TYPE = None) -> \
Dict[str, Any]:
    """
    COMPREHENSIVE USER DATA RECOVERY FROM WALRUS
    Retrieves ALL user data from Walrus in case of local data loss or password issues.

    Returns: {
        'success': bool,
        'recovered_data': {
            'session': dict,
            'wallet': dict,
            'tasks': list,
            'checkins': dict,
            'registration_receipt': dict
        },
        'summary': str,
        'errors': list
    }
    """
    recovered_data = {
        'session': {},
        'wallet': {},
        'tasks': [],
        'checkins': {},
        'registration_receipt': {}
    }
    errors = []

    try:
        # ============= 1. RECOVER SESSION DATA =============
        try:
            session_data = await session_manager.load_user_session(telegram_id, password)
            if session_data:
                recovered_data['session'] = session_data
            else:
                errors.append("Session recovery failed - wrong password or no session found")
        except Exception as e:
            errors.append(f"Session recovery error: {str(e)}")

        # ============= 2. RECOVER WALLET DATA =============
        try:
            # Try multiple possible wallet blob IDs
            possible_wallet_blobs = [
                f"{telegram_id}_wallet",
                f"wallet_{telegram_id}",
                f"{telegram_id}_sui_wallet",
                f"sui_wallet_{telegram_id}"
            ]

            key_manager = get_key_manager()
            for blob_id in possible_wallet_blobs:
                try:
                    wallet_data = key_manager.retrieve_encrypted_object(blob_id, telegram_id, password)
                    if wallet_data and 'mnemonic' in wallet_data:
                        recovered_data['wallet'] = {
                            'address': wallet_data.get('address'),
                            'has_mnemonic': 'mnemonic' in wallet_data,
                            'blob_id': blob_id
                        }
                        break
                except:
                    continue

            if not recovered_data['wallet']:
                errors.append("Wallet recovery failed - no wallet backup found")

        except Exception as e:
            errors.append(f"Wallet recovery error: {str(e)}")

        # ============= 3. RECOVER TASKS =============
        try:
            # Get profile ID from recovered session or try to find it
            profile_id = recovered_data['session'].get('profile_id')
            if not profile_id:
                # Try to find profile ID from registration receipts
                profile_id = await find_profile_id_from_walrus(telegram_id, password)

            if profile_id:
                # Use Sui client to get user tasks
                sui_client = get_sui_client()
                user_tasks = sui_client.get_user_tasks(profile_id)

                if user_tasks:
                    # Decrypt each task
                    for task in user_tasks:
                        try:
                            encrypted_blob = task.get('encrypted_details_blob')
                            if encrypted_blob:
                                # Try to decrypt with current password
                                decrypted_task = await decrypt_task_with_password(
                                    encrypted_blob, telegram_id, password
                                )
                                if decrypted_task:
                                    recovered_data['tasks'].append({
                                        'task_id': task.get('task_id'),
                                        'name': decrypted_task.get('task_name', 'Unknown'),
                                        'due_date': decrypted_task.get('due_date'),
                                        'status': task.get('status', 'unknown')
                                    })
                        except Exception:
                            pass

                else:
                    errors.append("No tasks found on blockchain")
            else:
                errors.append("No profile ID found - cannot recover tasks")

        except Exception as e:
            errors.append(f"Tasks recovery error: {str(e)}")

        # ============= 4. RECOVER CHECKIN DATA =============
        try:
            checkin_blob_id = f"{telegram_id}_checkins"
            key_manager = get_key_manager()
            checkin_data = key_manager.retrieve_encrypted_object(checkin_blob_id, telegram_id, password)

            if checkin_data:
                recovered_data['checkins'] = {
                    'total_checkins': checkin_data.get('total', 0),
                    'last_checkin': checkin_data.get('last_checkin'),
                    'checkin_history': checkin_data.get('checkins', [])[:10]  # Last 10 checkins
                }
            else:
                errors.append("No checkin data found")

        except Exception as e:
            errors.append(f"Checkin recovery error: {str(e)}")

        # ============= 5. RECOVER REGISTRATION RECEIPT =============
        try:
            receipt_blob_id = f"{telegram_id}_registration_receipt"
            key_manager = get_key_manager()
            receipt_data = key_manager.retrieve_encrypted_object(receipt_blob_id, telegram_id, password)

            if receipt_data:
                recovered_data['registration_receipt'] = receipt_data
            else:
                errors.append("No registration receipt found")

        except Exception as e:
            errors.append(f"Registration receipt recovery error: {str(e)}")

        # ============= 6. CREATE RECOVERY SUMMARY =============
        summary_parts = []

        if recovered_data['session']:
            summary_parts.append(f"✅ **Session**: Profile ID found")

        if recovered_data['wallet']:
            summary_parts.append(f"✅ **Wallet**: Address recovered")

        if recovered_data['tasks']:
            summary_parts.append(f"✅ **Tasks**: {len(recovered_data['tasks'])} tasks recovered")

        if recovered_data['checkins']:
            summary_parts.append(f"✅ **Checkins**: {recovered_data['checkins']['total_checkins']} total checkins")

        if recovered_data['registration_receipt']:
            summary_parts.append(f"✅ **Registration**: Complete receipt recovered")

        if not summary_parts:
            summary_parts.append("❌ **No data recovered** - Please check your password")

        summary = "\n".join(summary_parts)

        # Final result
        result = {
            'success': len(summary_parts) > 0,
            'recovered_data': recovered_data,
            'summary': summary,
            'errors': errors
        }

        return result

    except Exception as e:
        return {
            'success': False,
            'recovered_data': {},
            'summary': f"❌ Recovery failed: {str(e)}",
            'errors': [f"Comprehensive recovery failed: {str(e)}"]
        }


async def find_profile_id_from_walrus(telegram_id: str, password: str) -> Optional[str]:
    """Find profile ID from various Walrus sources"""
    try:
        key_manager = get_key_manager()

        # Try registration receipt first
        receipt_blob_id = f"{telegram_id}_registration_receipt"
        receipt_data = key_manager.retrieve_encrypted_object(receipt_blob_id, telegram_id, password)
        if receipt_data:
            profile_id = receipt_data.get('blockchain', {}).get('profile_id')
            if profile_id and profile_id != 'local_registration':
                return profile_id

        # Try session data
        session_data = await session_manager.load_user_session(telegram_id, password)
        if session_data and session_data.get('profile_id'):
            return session_data['profile_id']

    except Exception:
        pass

    return None


async def decrypt_task_with_password(encrypted_blob: str, telegram_id: str, password: str) -> Optional[Dict]:
    """Decrypt a task using user's password"""
    try:
        # This would need to be implemented based on your task encryption method
        # For now, returning a placeholder implementation
        walrus_client = get_walrus_client()

        return None

    except Exception:
        return None

async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Cancel conversation."""
    await update.message.reply_text("❌ Cancelled.")
    context.user_data.clear()
    return ConversationHandler.END


auth_conv_handler = ConversationHandler(
    entry_points=[],
    states={
        AUTHENTICATION_STATE: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, handle_authentication)
        ],
    },
    fallbacks=[CommandHandler('cancel', cancel)],
    per_message=False,
    name="authentication"
)