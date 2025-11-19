"""
Utility functions for Tovira Telegram Bot and User Registration System
"""
import hashlib
from pysui.sui.sui_txn import SyncTransaction
from pysui.sui.sui_clients.sync_client import SuiClient
from pysui.sui.sui_crypto import SuiKeyPair
from pysui.sui.sui_types.address import SuiAddress
from supabase import create_client
import base64
import os
import re
import logging
import json
from pathlib import Path
from datetime import datetime
from typing import Dict, Optional, Tuple, Any
import pytz
from telegram.ext import ContextTypes
from parsedatetime import Calendar
from app.telegram_bot.walrus_client import WalrusClient, UserKeyManager
from app.telegram_bot.suiclient import CopilotSuiClient

# Configure logging
logger = logging.getLogger(__name__)

# Global user sessions
user_sessions = {}

# Singleton instances
_walrus_client = None
_key_manager = None
_sui_client = None

# ============= FACTORY FUNCTIONS =============


def get_walrus_client() -> WalrusClient:
    """Get singleton WalrusClient instance."""
    global _walrus_client
    if _walrus_client is None:
        _walrus_client = WalrusClient()
    return _walrus_client


def get_key_manager() -> UserKeyManager:
    """Get singleton UserKeyManager instance."""
    global _key_manager
    if _key_manager is None:
        _key_manager = UserKeyManager()
    return _key_manager


def get_sui_client() -> CopilotSuiClient:
    """Get singleton CopilotSuiClient instance."""
    global _sui_client
    if _sui_client is None:
        _sui_client = CopilotSuiClient()
    return _sui_client

# ============= VALIDATION FUNCTIONS =============


async def ensure_user_has_keys(telegram_id: str, context: ContextTypes.DEFAULT_TYPE) -> bool:
    """Ensure user has encryption keys."""
    public_key = get_key_manager().get_user_public_key(telegram_id)
    if public_key:
        context.user_data['public_key'] = public_key
        return True
    return False


async def create_user_keys(telegram_id: str, password: str, context: ContextTypes.DEFAULT_TYPE) -> bool:
    """Create user encryption keys."""
    try:
        public_key_str, encrypted_private = get_key_manager(
        ).create_user_keys(telegram_id, password)
        context.user_data['public_key'] = public_key_str.encode('utf-8')
        context.user_data['has_encryption_keys'] = True
        logger.info(f"Created encryption keys for {telegram_id}")
        return True
    except Exception as e:
        logger.error(f"Error creating keys: {e}")
        return False


async def get_user_private_key(telegram_id: str, password: str) -> Optional[bytes]:
    """Decrypt user's private key."""
    try:
        return get_key_manager().get_user_private_key(telegram_id, password)
    except Exception as e:
        logger.error(f"Error getting private key: {e}")
        return None


def is_strong_password(password: str) -> Tuple[bool, str]:
    """Validate password strength."""
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
    """Validate email format."""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email))


def is_valid_telegram_id(telegram_id: str) -> bool:
    """Validate Telegram ID format."""
    return telegram_id.isdigit() and len(telegram_id) > 0


def is_valid_referral_code(code: str) -> bool:
    """Validate user referral code format."""
    return len(code) == 8 and code.isalnum()


def is_valid_admin_code(code: str) -> bool:
    """Validate admin referral code format."""
    return code.startswith('ADM-') and len(code) == 17


def is_admin(telegram_id: str) -> bool:
    """Check if user is admin."""
    admin_ids = set(os.getenv('ADMIN_TELEGRAM_IDS', '').split(','))
    return str(telegram_id) in admin_ids

# ============= SESSION MANAGEMENT =============


async def load_user_session(user_id: str, context: ContextTypes.DEFAULT_TYPE) -> Optional[Dict[str, Any]]:
    logger.debug(f"Loading session for user {user_id}")
    try:
        # Validate telegram_id
        if not is_valid_telegram_id(user_id):
            logger.warning(f"Invalid telegram_id: {user_id}")
            return None

        session = context.user_data.get('session', {})
        if session and session.get('profile_id'):
            try:
                SuiAddress(session['profile_id'])  # Validate as Sui address
                logger.debug(
                    f"Session found in context with valid profile_id for user {user_id}: {session}")
                return session
            except Exception as e:
                logger.warning(
                    f"Invalid profile_id in session for user {user_id}: {e}")
                session = {}

        # Reconstruct session
        walrus = get_walrus_client()
        key_manager = get_key_manager()
        session = {'telegram_id': user_id}

        # Get encrypted_data_blob
        blob_id = context.user_data.get('encrypted_data_blob')
        if blob_id:
            session['encrypted_data_blob'] = blob_id
            logger.debug(
                f"Loaded blob_id from context for user {user_id}: {blob_id}")

        # Try receipts
        profile_id = find_profile_id_from_receipt(user_id)
        if profile_id:
            try:
                SuiAddress(profile_id)
                session['profile_id'] = profile_id
                logger.debug(
                    f"Loaded profile_id from receipt for user {user_id}: {profile_id}")
            except Exception as e:
                logger.warning(
                    f"Invalid profile_id from receipt for user {user_id}: {e}")

        # Try blockchain
        public_key = key_manager.get_user_public_key(user_id)
        if public_key and not session.get('profile_id'):
            try:
                sui = get_sui_client()
                profile_data = sui.find_profile_id_from_receipt(public_key)
                if profile_data and profile_data.get('profile_id'):
                    try:
                        SuiAddress(profile_data['profile_id'])
                        session['profile_id'] = profile_data['profile_id']
                        logger.debug(
                            f"Loaded profile_id from blockchain for user {user_id}: {session['profile_id']}")
                    except Exception as e:
                        logger.warning(
                            f"Invalid profile_id from blockchain for user {user_id}: {e}")
            except Exception as e:
                logger.warning(
                    f"Failed to fetch profile from blockchain for user {user_id}: {e}")

        # If no profile_id, create a new Sui account and Profile object
        if not session.get('profile_id'):
            try:
                supabase = create_client(
                    os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))
                profile = supabase.table("user_profiles").select(
                    "*").eq("telegram_id", user_id).execute()
                if profile.data:
                    profile_id = profile.data[0]['profile_id']
                    try:
                        SuiAddress(profile_id)
                        session['profile_id'] = profile_id
                        session['user_address'] = profile.data[0].get(
                            'user_address', profile_id)
                        logger.debug(
                            f"Loaded profile_id from Supabase for user {user_id}: {profile_id}")
                    except Exception as e:
                        logger.warning(
                            f"Invalid profile_id from Supabase for user {user_id}: {e}")
                else:
                    # Create a new Sui account
                    sui_client: SuiClient = get_sui_client()
                    keypair = SuiKeyPair.ed25519()
                    new_address = keypair.address

                    # Create a Profile object on-chain
                    package_id = "YOUR_PACKAGE_ID"  # Replace with your Move package ID
                    module_name = "YOUR_MODULE_NAME"  # Replace with your module name
                    profile_txn = SyncTransaction(client=sui_client)
                    profile_txn.move_call(
                        target=f"{package_id}::{module_name}::create_profile",
                        arguments=[str(new_address)],
                        type_arguments=[]
                    )
                    profile_result = profile_txn.execute(gas_budget=10000000)
                    if profile_result.is_ok():
                        # Fund the new account
                        funding_txn = SyncTransaction(client=sui_client)
                        funding_txn.transfer_sui(
                            recipient=new_address,
                            amount=1000000000)
                        funding_result = funding_txn.execute(
                            gas_budget=1000000)
                        if not funding_result.is_ok():
                            logger.error(
                                f"Failed to fund new account for user {user_id}: {funding_result.result_string}")
                            return None
                        # Extract Profile object ID
                        profile_id = profile_result.result_data.get('created_objects', [{}])[
                            0].get('object_id', None)
                        if not profile_id:
                            logger.error(
                                f"Failed to extract Profile object ID for user {user_id}")
                            return None

                        # Store in Supabase
                        supabase.table("user_profiles").insert({
                            "telegram_id": user_id,
                            "profile_id": profile_id,
                            "user_address": str(new_address),
                            "created_at": datetime.now(pytz.UTC).isoformat()
                        }).execute()
                        session['profile_id'] = profile_id
                        session['user_address'] = str(new_address)
                        logger.debug(
                            f"Created Profile object for user {user_id}: {profile_id}")

                        # Store keypair
                        key_manager.store_user_keypair(user_id, keypair)
                    else:
                        logger.error(
                            f"Failed to create Profile object: {profile_result.result_string}")
                        return None
            except Exception as e:
                logger.error(
                    f"Failed to fetch/create profile in Supabase for user {user_id}: {e}")
                return None

        # Initialize points
        if 'points' not in session:
            session['points'] = 0

        # Save session
        context.user_data['session'] = session
        await save_user_session(user_id, context)
        logger.debug(f"Reconstructed session for user {user_id}: {session}")

        return session

    except Exception as e:
        logger.error(
            f"Error loading session for user {user_id}: {e}", exc_info=True)
        return None


def find_profile_id_from_receipt(user_id: str) -> Optional[str]:
    """Find profile ID from registration receipt for a given user_id."""
    logger.debug(f"Searching for profile_id in receipts for user {user_id}")
    try:
        receipts_dir = Path('./registration_receipts')
        if not receipts_dir.exists():
            logger.warning(
                f"Receipts directory does not exist for user {user_id}")
            return None

        for receipt_path in receipts_dir.glob(f"{user_id}_*.json"):
            try:
                with open(receipt_path, 'r') as f:
                    receipt = json.load(f)
                    if receipt.get('telegram_id') == user_id and receipt.get('status') == 'blockchain':
                        profile_id = receipt.get('profile_id')
                        if profile_id:
                            logger.debug(
                                f"Found profile_id {profile_id} in receipt {receipt_path} for user {user_id}")
                            return profile_id
                        else:
                            logger.info(
                                f"Receipt {receipt_path} for user {user_id} has no profile_id (local_only mode)")
            except Exception as e:
                logger.warning(f"Error reading receipt {receipt_path}: {e}")
        logger.info(
            f"No valid profile_id found in receipts for user {user_id}")
        return None
    except Exception as e:
        logger.error(
            f"Error searching receipts for user {user_id}: {e}", exc_info=True)
        return None


async def save_user_session_to_blockchain(telegram_id: str, context: ContextTypes.DEFAULT_TYPE):
    """Save user session with encryption to blockchain."""
    try:
        profile_id = context.user_data.get('profile_id')
        if not profile_id:
            return
        public_key = context.user_data.get('public_key')
        if not public_key:
            public_key = get_key_manager().get_user_public_key(telegram_id)
        if not public_key:
            return
        sensitive_data = {
            'telegram_id': telegram_id,
            'email': context.user_data.get('email', ''),
            'phone': context.user_data.get('phone', ''),
            'timezone': context.user_data.get('timezone', 'UTC'),
            'preferences': context.user_data.get('preferences', {}),
            'last_updated': datetime.now().isoformat()
        }
        encrypted_blob_id = get_walrus_client().store_encrypted_user_data(
            public_key, sensitive_data)
        if encrypted_blob_id:
            success = get_sui_client().update_encrypted_data(profile_id, encrypted_blob_id)
            if success:
                context.user_data['encrypted_data_blob'] = encrypted_blob_id
                user_sessions[telegram_id]['encrypted_data_blob'] = encrypted_blob_id
    except Exception as e:
        logger.error(f"Error saving session: {e}")


def clear_user_session(telegram_id: str) -> bool:
    """Clear user session data."""
    try:
        if telegram_id in user_sessions:
            del user_sessions[telegram_id]
        logger.info(f"Session cleared for user {telegram_id}")
        return True
    except Exception as e:
        logger.error(f"Error clearing session for {telegram_id}: {e}")
        return False


# Alias for checkin.py compatibility
save_user_session = save_user_session_to_blockchain

# ============= TIME & DATE FUNCTIONS =============


def parse_natural_language_date(text: str) -> Optional[datetime]:
    """Parse natural language date input."""
    try:
        cal = Calendar()
        time_struct, parse_status = cal.parse(text)
        if parse_status:
            return datetime(*time_struct[:6])
        return None
    except Exception as e:
        logger.error(f"Error parsing date '{text}': {e}")
        return None


def format_date_for_display(dt: datetime) -> str:
    """Format datetime for user-friendly display."""
    return dt.strftime('%Y-%m-%d %H:%M')


def get_current_utc() -> datetime:
    """Get current UTC time."""
    return datetime.now(pytz.UTC)


async def save_user_timezone(telegram_id: str, timezone: str, context: ContextTypes.DEFAULT_TYPE) -> bool:
    """Save user's timezone preference permanently"""
    try:
        logger.info(f"💾 Saving timezone '{timezone}' for user {telegram_id}")

        # Validate timezone first
        try:
            pytz.timezone(timezone)
        except pytz.UnknownTimeZoneError:
            logger.error(f"Invalid timezone: {timezone}")
            return False

        # Method 1: Save to session
        session = await load_user_session(telegram_id, context)
        if not session:
            session = {}

        session['timezone'] = timezone
        await save_user_session(telegram_id, context, session)

        # Method 2: Save to dedicated timezone file (backup)
        timezone_dir = Path('./user_timezones')
        timezone_dir.mkdir(exist_ok=True)

        timezone_file = timezone_dir / f"{telegram_id}.txt"
        with open(timezone_file, 'w') as f:
            f.write(timezone)

        # Method 3: Update context
        context.user_data['user_timezone'] = timezone

        logger.info(
            f"✅ Timezone '{timezone}' saved successfully for user {telegram_id}")
        return True

    except Exception as e:
        logger.error(f"❌ Error saving timezone for user {telegram_id}: {e}")
        return False


async def load_user_timezone(telegram_id: str, context: ContextTypes.DEFAULT_TYPE) -> str:
    """Load user's timezone preference with better debugging"""
    logger.info(f"🔍 Loading timezone for user {telegram_id}")

    try:
        # Method 1: Try session first
        session = await load_user_session(telegram_id, context)
        if session and session.get('timezone'):
            timezone = session['timezone']
            logger.info(f"✅ Loaded timezone from session: {timezone}")
            return timezone

        # Method 2: Check if we have a stored timezone file
        timezone_file = Path(f'./user_timezones/{telegram_id}.txt')
        if timezone_file.exists():
            with open(timezone_file, 'r') as f:
                timezone = f.read().strip()
                logger.info(f"✅ Loaded timezone from file: {timezone}")

                # Update session for future use
                if session:
                    session['timezone'] = timezone
                    await save_user_session(telegram_id, context, session)

                return timezone

        # Method 3: Check context user_data
        user_data_tz = context.user_data.get('user_timezone')
        if user_data_tz:
            logger.info(f"✅ Loaded timezone from user_data: {user_data_tz}")
            return user_data_tz

        # Default to UTC
        logger.info(f"⚠️ No timezone found for user {telegram_id}, using UTC")
        return 'UTC'

    except Exception as e:
        logger.error(f"❌ Error loading timezone for user {telegram_id}: {e}")
        return 'UTC'

# ============= ENCRYPTION & SECURITY =============


def validate_encryption_keys(public_key: Optional[bytes], private_key: Optional[bytes]) -> bool:
    """Validate that encryption keys exist and are valid."""
    return public_key is not None and private_key is not None


def generate_user_identifier(telegram_id: str, username: str) -> str:
    """Generate a unique user identifier."""
    timestamp = int(datetime.now().timestamp())
    return f"{telegram_id}_{username}_{timestamp}"

# ============= DATA FORMATTING =============


def format_profile_data(profile_data: Dict) -> str:
    """Format profile data for display."""
    if not profile_data:
        return "No profile data available"
    lines = []
    if 'username' in profile_data:
        lines.append(f"👤 Username: {profile_data['username']}")
    if 'email' in profile_data and profile_data['email']:
        lines.append(f"📧 Email: {profile_data['email']}")
    if 'telegram_id' in profile_data:
        lines.append(f"🆔 Telegram ID: {profile_data['telegram_id']}")
    if 'timezone' in profile_data:
        lines.append(f"🌐 Timezone: {profile_data['timezone']}")
    if 'created_at' in profile_data:
        created = parse_natural_language_date(profile_data['created_at'])
        if created:
            lines.append(f"📅 Joined: {format_date_for_display(created)}")
    return "\n".join(lines)


def format_task_data(task_data: Dict) -> str:
    """Format task data for display."""
    if not task_data:
        return "No task data available"
    lines = []
    if 'task_name' in task_data:
        lines.append(f"📝 {task_data['task_name']}")
    if 'description' in task_data and task_data['description']:
        lines.append(f"📋 {task_data['description']}")
    if 'due_date' in task_data and task_data['due_date']:
        due_date = parse_natural_language_date(task_data['due_date'])
        if due_date:
            lines.append(f"📅 Due: {format_date_for_display(due_date)}")
    if 'status' in task_data:
        status_emoji = "✅" if task_data['status'] == 'completed' else "⏳"
        lines.append(f"{status_emoji} Status: {task_data['status']}")
    return "\n".join(lines)

# ============= ERROR HANDLING =============


class RegistrationError(Exception):
    """Custom exception for registration errors."""
    pass


class EncryptionError(Exception):
    """Custom exception for encryption errors."""
    pass


class BlockchainError(Exception):
    """Custom exception for blockchain errors."""
    pass


def handle_error(error: Exception, context: str = "") -> str:
    """Handle errors and return user-friendly message."""
    logger.error(f"Error in {context}: {error}")
    if isinstance(error, RegistrationError):
        return f"❌ Registration error: {str(error)}"
    elif isinstance(error, EncryptionError):
        return f"🔐 Encryption error: {str(error)}"
    elif isinstance(error, BlockchainError):
        return f"⛓️ Blockchain error: {str(error)}"
    else:
        return "❌ An unexpected error occurred. Please try again."


def store_user_keypair(self, telegram_id: str, keypair: SuiKeyPair):
    """Store a Sui keypair for a user."""
    try:
        key_data = {
            'public_key': str(keypair.public_key),
            # Encrypt this in production
            'private_key': str(keypair.private_key)
        }
        # Store in Supabase or secure storage
        supabase = create_client(
            os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))
        supabase.table("user_keys").insert({
            "telegram_id": telegram_id,
            "public_key": key_data['public_key'],
            "private_key": key_data['private_key'],  # Encrypt before storing
            "created_at": datetime.now(pytz.UTC).isoformat()
        }).execute()
        logger.debug(f"Stored keypair for user {telegram_id}")
    except Exception as e:
        logger.error(f"Failed to store keypair for user {telegram_id}: {e}")

    # async def select_registration_method(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
    #     """Let user choose registration method via buttons."""
    #     keyboard = [
    #          [InlineKeyboardButton("🆕 Signup with TOVIRA", callback_data='signup_no_code')],
    #     #     [InlineKeyboardButton("🎁 Use User Referral", callback_data='signup_user_code')],
    #     #     [InlineKeyboardButton("🔑 Use Admin Code", callback_data='signup_admin_code')],
    #      ]
    #     #reply_markup = InlineKeyboardMarkup(keyboard)
    #     await update.message.reply_text(
    #         "⛓️ Register with Tovira\n\n",
    #         #"🆕 Register\n",
    #         #"🎁 User Referral - Use friend's code\n"
    #         #"🔑 Admin Code - Use special admin code\n\n"
    #         #"Select an option:",
    #         reply_markup=reply_markup
    #     )
    #     return SELECT_METHOD
