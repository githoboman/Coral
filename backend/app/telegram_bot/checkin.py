from telegram import Update
from telegram.ext import ContextTypes, CommandHandler, ConversationHandler
from datetime import datetime, timedelta
import pytz
from typing import Optional, Dict, Any
import asyncio
from app.telegram_bot.secure_storage import load_user_checkin_data, save_user_checkin_data

# Import all utilities from utils.py
from app.telegram_bot.utils import (
    get_walrus_client, get_key_manager, get_sui_client,
    load_user_session, save_user_session, ensure_user_has_keys,
    get_user_private_key, is_strong_password, create_user_keys
)

sui_client = get_sui_client()
walrus_client = get_walrus_client()
key_manager = get_key_manager()


def get_streak_reward_points(streak_day: int) -> int:
    """
    Returns bonus points based on streak milestone
    Day 5  → 2 pts   (total that day: 2)
    Day 10 → 3 pts
    Day 15 → 4 pts
    Day 20 → 5 pts
    Day 25 → 6 pts
    Day 30 → 10 pts (MEGA BONUS)
    All other days → 1 pt
    """
    milestones = {
        5: 2,
        10: 3,
        15: 4,
        20: 5,
        25: 6,
        30: 10
    }
    return milestones.get(streak_day, 1)


class CheckInManager:
    def __init__(self):
        self.walrus = get_walrus_client()
        self.key_manager = get_key_manager()
        self.sui = get_sui_client()

    async def has_checked_in_recently(self, user_id: str, context: ContextTypes.DEFAULT_TYPE):
        """Check if user has checked in within last 24 hours with multiple fallbacks"""
        session = await load_user_session(user_id, context)
        if not session:
            return False, None, None

        now = datetime.now(pytz.UTC)
        password = session.get('password')
        profile_id = session.get('profile_id')

        # PRIORITY 1: Check encrypted local file (most reliable)
        if password:
            try:
                data = load_user_checkin_data(user_id, password)
                last_ts = data.get('last_checkin')
                if last_ts:
                    last_checkin = datetime.fromtimestamp(
                        last_ts / 1000.0, tz=pytz.UTC)
                    time_since_checkin = now - last_checkin
                    if time_since_checkin < timedelta(hours=24):
                        next_available = last_checkin + timedelta(hours=24)
                        return True, last_checkin, next_available
            except Exception as e:
                pass

        # PRIORITY 2: Check session data
        last_checkin_str = session.get('last_checkin')
        if last_checkin_str:
            try:
                last_checkin = datetime.fromisoformat(
                    last_checkin_str.replace('Z', '+00:00'))
                time_since_checkin = now - last_checkin
                if time_since_checkin < timedelta(hours=24):
                    next_available = last_checkin + timedelta(hours=24)
                    return True, last_checkin, next_available
            except Exception as e:
                pass

        # PRIORITY 3: Check blockchain (slowest)
        if profile_id:
            try:
                profile = await asyncio.wait_for(
                    asyncio.get_event_loop().run_in_executor(
                        None, lambda: self.sui.get_user_details(profile_id)
                    ), timeout=8.0
                )
                if profile and profile.get('last_checkin'):
                    last_ts = int(profile['last_checkin'])
                    last_checkin = datetime.fromtimestamp(
                        last_ts / 1000.0, tz=pytz.UTC)
                    time_since_checkin = now - last_checkin
                    if time_since_checkin < timedelta(hours=24):
                        next_available = last_checkin + timedelta(hours=24)
                        return True, last_checkin, next_available
            except Exception as e:
                pass

        return False, None, None

    async def record_check_in(self, user_id: str, context: ContextTypes.DEFAULT_TYPE) -> bool:
        try:
            session = await load_user_session(user_id, context)
            if not session:
                return False

            profile_id = session.get('profile_id')
            password = session.get('password')

            current_timestamp_ms = int(
                datetime.now(pytz.UTC).timestamp() * 1000)
            current_time_utc = datetime.now(pytz.UTC)

            checkin_entry = {
                'timestamp': current_timestamp_ms,
                'date': current_time_utc.strftime("%Y-%m-%d"),
                'points_earned': 1
            }

            # Load + update check-in history
            checkin_data = {"checkins": [], "total": 0, "last_checkin": None}
            if password:
                try:
                    checkin_data = load_user_checkin_data(user_id, password)
                except:
                    pass  # Start fresh if no file exists

            checkin_data['checkins'].append(checkin_entry)
            checkin_data['total'] = len(checkin_data['checkins'])
            checkin_data['last_checkin'] = current_timestamp_ms

            # Save encrypted backup
            if password:
                save_user_checkin_data(user_id, password, checkin_data)

            # Update Walrus + blockchain
            public_key = self.key_manager.get_user_public_key(user_id)
            if public_key and profile_id:
                blob_id = self.walrus.store_encrypted_user_data(
                    public_key, checkin_data)
                if blob_id:
                    self.sui.update_encrypted_data(profile_id, blob_id)

            # UPDATE SESSION CORRECTLY
            session['points'] = session.get('points', 0) + 1
            session['last_checkin'] = current_time_utc.isoformat()
            session['checkin_count'] = checkin_data['total']

            # Save session properly
            await save_user_session(user_id, session)

            return True
        except Exception as e:
            return False

    async def process_check_in(self, user_id: str, context: ContextTypes.DEFAULT_TYPE) -> Dict[str, Any]:
        try:
            # FIRST: Check if user has already checked in recently
            has_checked_in, last_checkin, next_available = await self.has_checked_in_recently(user_id, context)

            if has_checked_in and next_available:
                time_remaining = next_available - datetime.now(pytz.UTC)
                total_seconds = int(time_remaining.total_seconds())
                hours, remainder = divmod(total_seconds, 3600)
                minutes, seconds = divmod(remainder, 60)

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
                    'message': f"⏰ **You've already checked in today!**\n\n🔄 Check back in {countdown_str} for your next point! ⭐",
                    'can_check_in_again': False,
                    'next_checkin_time': next_available
                }

            # If we get here, user can check in
            session = await load_user_session(user_id, context)
            if not session:
                return {
                    'success': False,
                    'message': "❌ Session not found. Please use /start to set up your account.",
                    'can_check_in_again': True
                }

            profile_id = session.get('profile_id')
            session_status = session.get('status', 'local_only')
            password = session.get('password')

            # === DETERMINE CURRENT STREAK FROM ENCRYPTED CHECK-IN FILE (MOST ACCURATE) ===
            current_streak = session.get('checkin_count', 0) + 1  # fallback
            if password:
                try:
                    checkin_data = load_user_checkin_data(user_id, password)
                    current_streak = checkin_data.get('total', 0) + 1
                except:
                    pass  # fallback to session

            points_earned_today = get_streak_reward_points(current_streak)

            # === BLOCKCHAIN MODE ===
            if profile_id and session_status == 'blockchain':
                # Perform blockchain check-in
                try:
                    success = await asyncio.wait_for(
                        asyncio.get_event_loop().run_in_executor(
                            None, lambda: self.sui.checkin(profile_id)
                        ), timeout=15.0
                    )
                    if not success:
                        return {
                            'success': False,
                            'message': "❌ Blockchain check-in failed. Try again later.",
                            'can_check_in_again': True
                        }
                except Exception as e:
                    return {
                        'success': False,
                        'message': "❌ Check-in failed. Please try again.",
                        'can_check_in_again': True
                    }

            # Record check-in (updates encrypted file + Walrus + session)
            await self.record_check_in(user_id, context)

            # Reload session to get updated points
            session = await load_user_session(user_id, context)
            total_points = session.get('points', 0)

            # === UNIFIED SUCCESS MESSAGE (BOTH MODES) ===
            if current_streak in [5, 10, 15, 20, 25, 30]:
                emoji = "🎆" if current_streak == 30 else "🎉"
                msg = (
                    f"**🎊 MILESTONE ACHIEVED! {emoji}**\n\n"
                    f"**🔥 {current_streak}-Day Streak!**\n"
                    f"**✨ Bonus Reward:** {points_earned_today} points today!\n\n"
                    f"**⭐ Total Points:** {total_points}\n\n"
                    f"{'🏆 LEGEND STATUS! 30-Day Streak = 10 POINTS! 🏆' if current_streak == 30 else '💪 Keep the streak going! Amazing work!'}"
                )
            else:
                next_milestone = min(
                    (d for d in [5, 10, 15, 20, 25, 30] if d > current_streak), default=None)
                next_reward = get_streak_reward_points(
                    next_milestone) if next_milestone else 1
                msg = (
                    f"✅ **Daily Check-in Complete!**\n\n"
                    f"**📅 Day {current_streak}** → +{points_earned_today} point{'s' if points_earned_today > 1 else ''} ⭐\n"
                    f"**🏆 Total Points:** {total_points}\n\n"
                    f"**🎯 Next Goal:** Day {next_milestone or '∞'} → **{next_reward} points!** 🚀"
                )

            return {
                'success': True,
                'message': msg,
                'points_earned': points_earned_today,
                'total_points': total_points,
                'streak_day': current_streak,
                'can_check_in_again': False
            }

        except Exception as e:
            return {
                'success': False,
                'message': "❌ An unexpected error occurred. Please try again.",
                'can_check_in_again': True
            }


checkin_manager = CheckInManager()


async def checkin_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = str(update.effective_user.id)
    username = update.effective_user.username or update.effective_user.first_name or "User"

    processing_msg = await update.message.reply_text(
        "🔄 Processing your check-in...\n"
        "• Checking eligibility...\n"
        "• Verifying cooldown...\n\n"
        "Please wait..."
    )

    try:
        session = await load_user_session(user_id, context)
        if not session:
            await processing_msg.edit_text("❌ No session found. Please use /start first.")
            return ConversationHandler.END

        # Fix broken profile_id
        if session.get('profile_id') and session.get('status') == 'blockchain':
            try:
                profile = sui_client.get_user_details(session['profile_id'])
                if not profile:
                    session['profile_id'] = None
                    session['status'] = 'local_only'
                    await save_user_session(user_id, session)
            except:
                session['profile_id'] = None
                session['status'] = 'local_only'
                await save_user_session(user_id, session)

        result = await checkin_manager.process_check_in(user_id, context)
        await processing_msg.edit_text(result['message'], parse_mode='Markdown')

    except Exception as e:
        await processing_msg.edit_text(
            "❌ **Check-in Failed**\n\n"
            "An error occurred while processing your check-in.\n\n"
            "✨ **Please try:**\n"
            "• Wait a moment and try again\n"
            "• Use `/start` to refresh your session\n"
            "• Contact support if this continues"
        )

    return ConversationHandler.END


async def checkin_status_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = str(update.effective_user.id)

    try:
        has_checked_in, last_checkin, next_avail = await checkin_manager.has_checked_in_recently(user_id, context)
        now = datetime.now(pytz.UTC)

        if has_checked_in and next_avail:
            time_remaining = next_avail - now
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

            msg = (
                f"📊 Check-in Status\n\n"
                f"Status: ✅ Already Checked In Today\n\n"
                f"⏰ Next check-in available in:\n"
                f"**{countdown_str}** ⭐\n\n"
                f"🔄 Come back later for your next point!"
            )
        else:
            msg = (
                f"📊 **Check-in Status**\n\n"
                f"**Status:** 🎯 Ready to Check In!\n\n"
                f"⭐ **You can check in now!**\n"
                f"Use `/checkin` to get your daily point! 🚀"
            )

        await update.message.reply_text(msg, parse_mode='Markdown')

    except Exception as e:
        await update.message.reply_text(
            "❌ Could not retrieve check-in status. Please try /start."
        )


async def check_my_profile(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = str(update.effective_user.id)
    session = await load_user_session(user_id, context)
    if not session or not session.get('profile_id'):
        await update.message.reply_text("❌ No profile found. Use /start.")
        return

    profile_id = session['profile_id']
    msg = await update.message.reply_text(f"🔍 Checking profile `{profile_id}`...", parse_mode='Markdown')


# Handlers
checkin_handler = CommandHandler('checkin', checkin_command)
checkin_status_handler = CommandHandler(
    'checkin_status', checkin_status_command)
check_my_profile_handler = CommandHandler('check_my_profile', check_my_profile)
