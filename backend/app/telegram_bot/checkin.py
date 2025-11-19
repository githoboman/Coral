from telegram import Update
from telegram.ext import ContextTypes, CommandHandler, ConversationHandler
from datetime import datetime, timedelta
import logging
import os
from dotenv import load_dotenv
import pytz
from typing import Optional, Dict, Any
import asyncio
# Import all utilities from utils.py
from app.telegram_bot.utils import (
    get_walrus_client, get_key_manager, get_sui_client,
    load_user_session, save_user_session, ensure_user_has_keys,
    get_user_private_key, user_sessions, is_strong_password, create_user_keys
)

load_dotenv()

LOG_DIR = os.path.join("/tmp", "logs")
os.makedirs(LOG_DIR, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(os.path.join(LOG_DIR, "copilot.log")),
        logging.StreamHandler()
    ]
)
logging.getLogger('pysui').setLevel(logging.ERROR)
logger = logging.getLogger(__name__)

sui_client = get_sui_client()
walrus_client = get_walrus_client()
key_manager = get_key_manager()


class CheckInManager:
    def __init__(self):
        self.walrus = get_walrus_client()
        self.key_manager = get_key_manager()
        self.sui = get_sui_client()

    async def has_checked_in_recently(self, user_id: str, context: ContextTypes.DEFAULT_TYPE) -> tuple:
        logger.debug(f"Checking recent check-in status for user {user_id}")
        try:
            session = await load_user_session(user_id, context)
            if not session:
                logger.error(f"No session found for user {user_id}")
                return False, None, None

            profile_id = session.get('profile_id')
            session_status = session.get('status', 'local_only')

            if profile_id and session_status == 'blockchain':
                try:
                    # Use get_user_details
                    profile_data = await asyncio.wait_for(
                        asyncio.get_event_loop().run_in_executor(
                            None, lambda: self.sui.get_user_details(profile_id)
                        ),
                        timeout=10.0
                    )
                    if profile_data and 'last_checkin' in profile_data:
                        last_checkin_ms = profile_data.get('last_checkin')
                        if last_checkin_ms:
                            # Convert millisecond timestamp to datetime
                            last_checkin = datetime.fromtimestamp(
                                int(last_checkin_ms) / 1000.0, tz=pytz.UTC)
                            now_utc = datetime.now(pytz.UTC)
                            time_since_checkin = now_utc - last_checkin
                            has_checked_in = time_since_checkin < timedelta(
                                hours=24)
                            next_available = last_checkin + \
                                timedelta(hours=24) if has_checked_in else None
                            return has_checked_in, last_checkin, next_available
                except asyncio.TimeoutError:
                    logger.warning(
                        f"Timeout checking profile for user {user_id}")
                except Exception as e:
                    logger.error(
                        f"Error checking profile for user {user_id}: {e}", exc_info=True)
                # Fallback to session data
            last_checkin_str = session.get('last_checkin')
            if last_checkin_str:
                last_checkin = self._parse_datetime(last_checkin_str)
                if last_checkin:
                    now_utc = datetime.now(pytz.UTC)
                    time_since_checkin = now_utc - last_checkin
                    has_checked_in = time_since_checkin < timedelta(hours=24)
                    next_available = last_checkin + \
                        timedelta(hours=24) if has_checked_in else None
                    return has_checked_in, last_checkin, next_available
            return False, None, None
        except Exception as e:
            logger.error(
                f"Error checking check-in status for user {user_id}: {e}", exc_info=True)
            return False, None, None

    async def record_check_in(self, user_id: str, context: ContextTypes.DEFAULT_TYPE) -> bool:
        logger.debug(f"Recording check-in for user {user_id}")
        try:
            session = await load_user_session(user_id, context)
            if not session:
                logger.error(f"No session found for user {user_id}")
                return False

            profile_id = session.get('profile_id')
            public_key = self.key_manager.get_user_public_key(user_id)
            if not public_key:
                logger.error(f"No public key found for user {user_id}")
                return False

            current_timestamp_ms = int(
                datetime.now(pytz.UTC).timestamp() * 1000)
            checkin_data = {
                'user_id': user_id,
                'timestamp': current_timestamp_ms,
                'checkin_count': session.get('checkin_count', 0) + 1
            }
            blob_id = self.walrus.store_encrypted_user_data(
                public_key, checkin_data)
            if not blob_id:
                logger.error(
                    f"Failed to store check-in data for user {user_id}")
                return False
            logger.info(f"✅ Encrypted user data stored: {blob_id}")

            if profile_id:
                try:
                    # Remove last_checkin argument
                    success = self.sui.update_encrypted_data(
                        profile_id, blob_id)
                    if not success:
                        logger.warning(
                            f"Failed to update encrypted data for profile_id {profile_id}")
                        return False
                except Exception as e:
                    logger.error(
                        f"Error updating encrypted data for profile_id {profile_id}: {e}", exc_info=True)
                    return False
            return True
        except Exception as e:
            logger.error(
                f"Error recording check-in for user {user_id}: {e}", exc_info=True)
            return False

    async def process_check_in(self, user_id: str, context: ContextTypes.DEFAULT_TYPE) -> Dict[str, Any]:
        logger.debug(f"Starting process_check_in for user {user_id}")
        try:
            session = await load_user_session(user_id, context)
            if not session:
                logger.error(f"No session for user {user_id}")
                return {
                    'success': False,
                    'message': "❌ Session not found. Please use /start to set up your account.",
                    'can_check_in_again': True
                }

            profile_id = session.get('profile_id')
            session_status = session.get('status', 'local_only')

            if profile_id and session_status == 'blockchain':
                has_checked_in, last_checkin, next_available = await self.has_checked_in_recently(user_id, context)
                logger.debug(
                    f"has_checked_in: {has_checked_in}, last_checkin: {last_checkin}, next_available: {next_available}")

                if has_checked_in and last_checkin and next_available:
                    now_utc = datetime.now(pytz.UTC)
                    time_remaining = next_available - now_utc
                    if time_remaining.total_seconds() > 0:
                        total_seconds = int(time_remaining.total_seconds())
                        hours = total_seconds // 3600
                        minutes = (total_seconds % 3600) // 60
                        seconds = total_seconds % 60
                        countdown = []
                        if hours > 0:
                            countdown.append(
                                f"{hours} hour{'s' if hours != 1 else ''}")
                        if minutes > 0:
                            countdown.append(
                                f"{minutes} minute{'s' if minutes != 1 else ''}")
                        if seconds > 0 or (hours == 0 and minutes == 0):
                            countdown.append(
                                f"{seconds} second{'s' if seconds != 1 else ''}")
                        countdown_str = ", ".join(countdown)
                        return {
                            'success': False,
                            'message': (
                                f"⏰ **You've already checked in recently!**\n\n"
                                f"🔄 Check back in {countdown_str} for your next point! ⭐"
                            ),
                            'can_check_in_again': False,
                            'next_checkin_time': next_available
                        }

                logger.debug(
                    f"Performing blockchain check-in for profile_id {profile_id}")
                try:
                    blockchain_success = await asyncio.wait_for(
                        asyncio.get_event_loop().run_in_executor(
                            None, lambda: self.sui.checkin(profile_id)
                        ),
                        timeout=15.0
                    )
                    logger.debug(
                        f"Blockchain check-in result: {blockchain_success}")
                    if not blockchain_success:
                        logger.error(
                            f"Blockchain check-in failed for user {user_id}")
                        return {
                            'success': False,
                            'message': "❌ Blockchain check-in failed. Please try again later.",
                            'can_check_in_again': True
                        }
                except asyncio.TimeoutError:
                    logger.error(
                        f"Timeout during blockchain check-in for profile_id {profile_id}")
                    return {
                        'success': False,
                        'message': "❌ Blockchain check-in timed out. Please try again later.",
                        'can_check_in_again': True
                    }
                except Exception as e:
                    logger.error(
                        f"Error during blockchain check-in for profile_id {profile_id}: {e}", exc_info=True)
                    return {
                        'success': False,
                        'message': f"❌ Blockchain check-in failed: {str(e)[:100]}...",
                        'can_check_in_again': True
                    }

                storage_success = await self.record_check_in(user_id, context)
                logger.debug(f"Storage success: {storage_success}")
                if not storage_success:
                    logger.warning(
                        f"Check-in recorded on blockchain but failed in storage for user {user_id}")

                # Fetch updated points from blockchain
                try:
                    profile_data = await asyncio.wait_for(
                        asyncio.get_event_loop().run_in_executor(
                            None, lambda: self.sui.get_user_details(profile_id)
                        ),
                        timeout=10.0
                    )
                    current_points = int(profile_data.get('points', '0'))
                except Exception as e:
                    logger.warning(
                        f"Failed to fetch updated points for profile_id {profile_id}: {e}")
                    current_points = session.get('points', 0) + 1

                session['points'] = current_points
                session['last_checkin'] = datetime.now(pytz.UTC).isoformat()
                context.user_data['session'] = session
                await save_user_session(user_id, context)
                logger.debug(f"Updated points: {current_points}")

                return {
                    'success': True,
                    'message': (
                        f"✅ **Daily Check-in Successful!** ⭐\n\n"
                        f"**🎉 You earned 1 point!**\n"
                        f"**Total points:** {current_points}\n\n"
                        f"⏰ **Check-in again in 24 hours for your next point!** ⭐\n\n"
                        f"Use `/referral` to share and earn more points! 🎁"
                    ),
                    'points_earned': 1,
                    'total_points': current_points,
                    'checkin_time': datetime.now(pytz.UTC),
                    'next_checkin_time': datetime.now(pytz.UTC) + timedelta(hours=24),
                    'can_check_in_again': False
                }

            # Local mode
            last_checkin_str = session.get('last_checkin')
            if last_checkin_str:
                last_checkin = self._parse_datetime(last_checkin_str)
                if last_checkin:
                    now_utc = datetime.now(pytz.UTC)
                    time_since_checkin = now_utc - last_checkin
                    has_checked_in = time_since_checkin < timedelta(hours=24)
                    next_available = last_checkin + \
                        timedelta(hours=24) if has_checked_in else None
                    if has_checked_in:
                        total_seconds = int(
                            (next_available - now_utc).total_seconds())
                        hours = total_seconds // 3600
                        minutes = (total_seconds % 3600) // 60
                        seconds = total_seconds % 60
                        countdown = []
                        if hours > 0:
                            countdown.append(
                                f"{hours} hour{'s' if hours != 1 else ''}")
                        if minutes > 0:
                            countdown.append(
                                f"{minutes} minute{'s' if minutes != 1 else ''}")
                        if seconds > 0 or (hours == 0 and minutes == 0):
                            countdown.append(
                                f"{seconds} second{'s' if seconds != 1 else ''}")
                        countdown_str = ", ".join(countdown)
                        return {
                            'success': False,
                            'message': (
                                f"⏰ **You've already checked in recently!**\n\n"
                                f"🔄 Check back in {countdown_str} for your next point! ⭐"
                            ),
                            'can_check_in_again': False,
                            'next_checkin_time': next_available
                        }

            current_time_utc = datetime.now(pytz.UTC)
            checkin_count = session.get('checkin_count', 0) + 1
            current_points = session.get('points', 0) + 1
            session.update({
                'last_checkin': current_time_utc.isoformat(),
                'checkin_count': checkin_count,
                'points': current_points,
                'status': 'local_only'
            })
            context.user_data['session'] = session
            await save_user_session(user_id, context)
            logger.info(
                f"Local check-in recorded for user {user_id} at {current_time_utc}")
            return {
                'success': True,
                'message': (
                    f"✅ **Daily Check-in Successful!** ⭐\n\n"
                    f"**🎉 You earned 1 point!**\n"
                    f"**Total points:** {current_points}\n\n"
                    f"⏰ **Check-in again in 24 hours for your next point!** ⭐\n\n"
                ),
                'points_earned': 1,
                'total_points': current_points,
                'checkin_time': current_time_utc,
                'next_checkin_time': current_time_utc + timedelta(hours=24),
                'can_check_in_again': False
            }

        except Exception as e:
            logger.error(
                f"Error in process_check_in for user {user_id}: {e}", exc_info=True)
            return {
                'success': False,
                'message': f"❌ An error occurred during check-in: {str(e)[:100]}...",
                'can_check_in_again': True
            }

    def _parse_datetime(self, dt_str: str) -> Optional[datetime]:
        try:
            return datetime.fromisoformat(dt_str.replace('Z', '+00:00'))
        except (ValueError, TypeError):
            logger.warning(f"Failed to parse datetime: {dt_str}")
            return None


checkin_manager = CheckInManager()
sui_client = get_sui_client()


async def checkin_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = str(update.effective_user.id)
    username = update.effective_user.username or update.effective_user.first_name
    logger.info(f"Received /checkin command from user {user_id} (@{username})")
    try:
        processing_msg = await update.message.reply_text(
            "🔄 Processing your check-in...\n"
            "• Checking profile...\n"
            "• Verifying eligibility...\n\n"
            "This may take a few seconds..."
        )

        session = await asyncio.wait_for(load_user_session(user_id, context), timeout=10.0)
        logger.debug(f"Session for user {user_id}: {session}")
        if not session:
            logger.error(f"No session found for user {user_id}")
            await processing_msg.edit_text(
                "❌ **No Session Found**\n\n"
                "Your session could not be loaded.\n\n"
                "✨ **Quick fix:**\n"
                "Use `/start` to recreate your session.\n\n"
                "Contact support if this persists."
            )
            return ConversationHandler.END

        profile_id = session.get('profile_id')
        session_status = session.get('status', 'local_only')
        if profile_id and session_status == 'blockchain':
            try:
                logger.debug(
                    f"Checking blockchain profile for profile_id {profile_id}")
                profile_data = await asyncio.wait_for(
                    asyncio.get_event_loop().run_in_executor(
                        None, lambda: sui_client.get_user_details(profile_id)
                    ),
                    timeout=10.0
                )
                if not profile_data:
                    logger.warning(
                        f"Blockchain profile missing for profile_id {profile_id}")
                    session['profile_id'] = None
                    session['status'] = 'local_only'
                    context.user_data['session'] = session
                    await save_user_session(user_id, context)
            except asyncio.TimeoutError:
                logger.error(
                    f"Timeout checking profile for profile_id {profile_id}")
                session['profile_id'] = None
                session['status'] = 'local_only'
                context.user_data['session'] = session
                await save_user_session(user_id, context)
            except Exception as e:
                logger.error(
                    f"Error checking profile for profile_id {profile_id}: {e}", exc_info=True)
                session['profile_id'] = None
                session['status'] = 'local_only'
                context.user_data['session'] = session
                await save_user_session(user_id, context)
        else:
            logger.info(
                f"No profile_id or local_only mode for user {user_id} (status: {session_status})")

        result = await asyncio.wait_for(checkin_manager.process_check_in(user_id, context), timeout=20.0)
        await processing_msg.edit_text(result['message'], parse_mode='Markdown')
        logger.info(
            f"Check-in {'successful' if result['success'] else 'failed'} for user {user_id}")

        return ConversationHandler.END

    except asyncio.TimeoutError:
        logger.error(f"Timeout in checkin_command for user {user_id}")
        await update.message.reply_text(
            "❌ **Check-in Timed Out**\n\n"
            "The process took too long.\n\n"
            "✨ **Please try:**\n"
            "1. Use `/start` to recreate your profile\n"
            "2. Contact support if this continues",
            parse_mode='Markdown'
        )
    except Exception as e:
        logger.error(
            f"Error in checkin_command for user {user_id}: {e}", exc_info=True)
        await update.message.reply_text(
            "❌ **Check-in Failed**\n\n"
            "We encountered an issue.\n\n"
            "✨ **Please try:**\n"
            "1. Use `/start` to recreate your profile\n"
            "2. Contact support if this continues",
            parse_mode='Markdown'
        )
    return ConversationHandler.END


async def checkin_status_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = str(update.effective_user.id)
    logger.debug(f"Checking status for user {user_id}")
    try:
        # REMOVED PASSWORD CHECK - Continue without password
        has_checked_in, last_checkin, next_available = await checkin_manager.has_checked_in_recently(user_id, context)
        now_utc = datetime.now(pytz.UTC)

        if has_checked_in and last_checkin and next_available:
            time_remaining = next_available - now_utc
            total_seconds = int(time_remaining.total_seconds())
            hours = total_seconds // 3600
            minutes = (total_seconds % 3600) // 60
            seconds = total_seconds % 60
            countdown = []
            if hours > 0:
                countdown.append(f"{hours} hour{'s' if hours != 1 else ''}")
            if minutes > 0:
                countdown.append(
                    f"{minutes} minute{'s' if minutes != 1 else ''}")
            if seconds > 0 or (hours == 0 and minutes == 0):
                countdown.append(
                    f"{seconds} second{'s' if seconds != 1 else ''}")
            countdown_str = ", ".join(countdown)
            status_msg = (
                f"📊 **Check-in Status**\n\n"
                f"**Status:** ✅ Checked In (Cooldown Active)\n"
                f"🔄 Check back in {countdown_str} for your next point! ⭐"
            )
        else:
            status_msg = (
                f"📊 **Check-in Status**\n\n"
                f"**Status:** ❌ Ready to Check In\n\n"
                f"**🎯 You can check in now!**\n"
                f"Use `/checkin` to get your daily point! ⭐"
            )

        await update.message.reply_text(status_msg, parse_mode='Markdown')

    except Exception as e:
        logger.error(f"Error in checkin_status_command: {e}", exc_info=True)
        await update.message.reply_text(
            "❌ Could not retrieve check-in status. Please try /start."
        )


async def check_my_profile(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = str(update.effective_user.id)
    logger.debug(f"Checking profile for user {user_id}")
    try:
        session = await load_user_session(user_id, context)
        if not session or not session.get('profile_id'):
            await update.message.reply_text("❌ No profile ID found in your session. Use /start first.")
            return

        profile_id = session['profile_id']
        await update.message.reply_text(
            f"🔍 **Checking Your Blockchain Profile**\n\n"
            f"**Profile ID:** `{profile_id}`\n"
            f"**Checking blockchain...**"
        )

        sui = get_sui_client()
        result = sui.client.get_object(profile_id)
        if result.is_ok():
            obj_data = result.result_data
            await update.message.reply_text(
                f"✅ **PROFILE EXISTS ON BLOCKCHAIN!**\n\n"
                f"**Profile ID:** `{profile_id}`\n"
                f"**Object Version:** {obj_data.version}\n"
                f"**Owner:** {getattr(obj_data.owner, 'address_owner', 'Unknown')}\n"
                f"**Digest:** {obj_data.digest}\n\n"
                f"✨ **Your profile is ready for check-ins!**"
            )

            profile_data = sui.get_user_profile(profile_id)
            if profile_data:
                last_checkin = profile_data.get('last_checkin', 'None')
                last_checkin_dt = checkin_manager._parse_datetime(
                    last_checkin) if last_checkin != 'None' else None
                last_checkin_display = last_checkin_dt.isoformat(
                ) if last_checkin_dt else last_checkin
                await update.message.reply_text(
                    f"📊 **Profile Details:**\n"
                    f"• Points: {int(profile_data.get('points', 0))}\n"
                    f"• Premium: {profile_data.get('is_premium', False)}\n"
                    f"• Referral Code: {profile_data.get('referral_code', 'Unknown')}\n"
                    f"• Encrypted Blob: {profile_data.get('encrypted_data_blob', 'Unknown')[:20]}...\n"
                    f"• Last Check-in: {last_checkin_display}"
                )
            else:
                await update.message.reply_text("⚠️ Could not load profile data, but object exists.")

        else:
            await update.message.reply_text(
                f"❌ **PROFILE NOT FOUND ON BLOCKCHAIN**\n\n"
                f"**Profile ID:** `{profile_id}`\n"
                f"**Error:** {result.result_string}\n\n"
                f"🔧 **This means:**\n"
                f"• Profile ID was generated but never created on-chain\n"
                f"• The blockchain transaction failed\n"
                f"• You need to recreate your profile\n\n"
                f"✨ **Solution:** Use `/start` to recreate your profile"
            )

    except Exception as e:
        logger.error(f"Error checking profile: {e}", exc_info=True)
        await update.message.reply_text(f"💥 Error checking profile: {str(e)}")

checkin_manager = CheckInManager()
checkin_handler = CommandHandler('checkin', checkin_command)
checkin_status_handler = CommandHandler(
    'checkin_status', checkin_status_command)
check_my_profile_handler = CommandHandler('check_my_profile', check_my_profile)
