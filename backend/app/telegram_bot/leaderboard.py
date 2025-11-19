import asyncio
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CommandHandler, CallbackQueryHandler
import logging
from pathlib import Path
import json
from app.telegram_bot.utils import get_sui_client, load_user_session

logger = logging.getLogger(__name__)
sui_client = get_sui_client()


async def fetch_all_user_profiles(sui_client):
    """
    Fetch all user profiles from registration receipts and blockchain.
    """
    logger.debug("Fetching all user profiles")
    profiles = []
    receipts_dir = Path('./registration_receipts')

    if not receipts_dir.exists():
        logger.warning("No registration_receipts directory found")
        return profiles

    for receipt_path in receipts_dir.glob('*.json'):
        try:
            with open(receipt_path, 'r') as f:
                receipt = json.load(f)
                profile_id = receipt.get('profile_id')
                telegram_id = receipt.get('telegram_id')
                username = receipt.get('username', 'Unknown')

                if profile_id and receipt.get('status') == 'blockchain':
                    try:
                        # Fetch profile data with timeout
                        profile_data = await asyncio.wait_for(
                            asyncio.get_event_loop().run_in_executor(
                                None, lambda: sui_client.get_user_details(
                                    profile_id)
                            ),
                            timeout=5.0
                        )
                        if profile_data:
                            profiles.append({
                                'profile_id': profile_id,
                                'telegram_id': telegram_id,
                                'username': username,
                                'points': int(profile_data.get('points', '0'))
                            })
                    except asyncio.TimeoutError:
                        logger.warning(
                            f"Timeout fetching profile {profile_id}")
                    except Exception as e:
                        logger.error(
                            f"Error fetching profile {profile_id}: {e}")
        except Exception as e:
            logger.error(f"Error reading receipt {receipt_path}: {e}")

    logger.debug(f"Fetched {len(profiles)} profiles")
    return profiles


async def leaderboard_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """
    Display the leaderboard with ranked users based on points.
    """
    telegram_id = str(update.effective_user.id)
    username = update.effective_user.username or update.effective_user.first_name or "Anonymous"
    logger.info(f"Leaderboard command from {telegram_id} (@{username})")

    try:
        # Load user session to get profile_id
        session = await load_user_session(telegram_id, context)
        user_profile_id = session.get('profile_id') if session else None

        # Fetch all user profiles
        profiles = await fetch_all_user_profiles(sui_client)
        sorted_profiles = sorted(
            profiles, key=lambda x: x.get('points', 0), reverse=True)

        # Build leaderboard text
        leaderboard_text = "🏆 **Leaderboard: Top Users**\n\n"
        user_rank = None
        for i, profile in enumerate(sorted_profiles[:10], 1):
            profile_id = profile.get('profile_id')
            points = profile.get('points', 0)
            profile_username = profile.get('username', 'Unknown')
            leaderboard_text += f"{i}️⃣ @{profile_username} (ID: {profile_id[:6]}...) - {points} Points\n"
            if profile.get('telegram_id') == telegram_id:
                user_rank = i

        if user_rank:
            leaderboard_text += f"\n📍 You (@{username}, ID: {telegram_id[:6]}...) - Rank {user_rank}, {sorted_profiles[user_rank - 1]['points']} Points"
        elif user_profile_id:
            # Check if user has points but not in top 10
            for i, profile in enumerate(sorted_profiles, 1):
                if profile.get('telegram_id') == telegram_id:
                    user_rank = i
                    leaderboard_text += f"\n📍 You (@{username}, ID: {telegram_id[:6]}...) - Rank {user_rank}, {profile['points']} Points"
                    break
            else:
                leaderboard_text += f"\n📍 You (@{username}, ID: {telegram_id[:6]}...) - 0 Points"
        else:
            leaderboard_text += f"\n📍 You (@{username}, ID: {telegram_id[:6]}...) - Not registered"

        # Inline buttons
        keyboard = [[InlineKeyboardButton(
            "🔄 Refresh", callback_data='refresh_leaderboard')]]
        reply_markup = InlineKeyboardMarkup(keyboard)

        await update.message.reply_text(leaderboard_text, reply_markup=reply_markup, parse_mode='Markdown')
    except Exception as e:
        logger.error(
            f"Error in leaderboard command for {telegram_id}: {e}", exc_info=True)
        await update.message.reply_text(
            "❌ Error loading leaderboard. Try `/start` or contact support.",
            parse_mode='Markdown'
        )


async def refresh_leaderboard_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """
    Handle the 'Refresh' button click to reload the leaderboard.
    """
    query = update.callback_query
    await query.answer()
    telegram_id = str(query.from_user.id)
    username = query.from_user.username or query.from_user.first_name or "Anonymous"
    logger.info(
        f"Refresh leaderboard button clicked by {telegram_id} (@{username})")

    try:
        # Show loading state
        await query.edit_message_text("🔄 Refreshing leaderboard...")

        # Load user session
        session = await load_user_session(telegram_id, context)
        user_profile_id = session.get('profile_id') if session else None

        # Fetch updated profiles
        profiles = await fetch_all_user_profiles(sui_client)
        sorted_profiles = sorted(
            profiles, key=lambda x: x.get('points', 0), reverse=True)

        # Build refreshed leaderboard text
        leaderboard_text = "🏆 **Leaderboard: Top Users**\n\n"
        user_rank = None
        for i, profile in enumerate(sorted_profiles[:10], 1):
            profile_id = profile.get('profile_id')
            points = profile.get('points', 0)
            profile_username = profile.get('username', 'Unknown')
            leaderboard_text += f"{i}️⃣ @{profile_username} (ID: {profile_id[:6]}...) - {points} Points\n"
            if profile.get('telegram_id') == telegram_id:
                user_rank = i

        if user_rank:
            leaderboard_text += f"\n📍 You (@{username}, ID: {telegram_id[:6]}...) - Rank {user_rank}, {sorted_profiles[user_rank - 1]['points']} Points"
        elif user_profile_id:
            for i, profile in enumerate(sorted_profiles, 1):
                if profile.get('telegram_id') == telegram_id:
                    user_rank = i
                    leaderboard_text += f"\n📍 You (@{username}, ID: {telegram_id[:6]}...) - Rank {user_rank}, {profile['points']} Points"
                    break
            else:
                leaderboard_text += f"\n📍 You (@{username}, ID: {telegram_id[:6]}...) - 0 Points"
        else:
            leaderboard_text += f"\n📍 You (@{username}, ID: {telegram_id[:6]}...) - Not registered"

        # Inline buttons
        keyboard = [[InlineKeyboardButton(
            "🔄 Refresh", callback_data='refresh_leaderboard')]]
        reply_markup = InlineKeyboardMarkup(keyboard)

        await query.edit_message_text(leaderboard_text, reply_markup=reply_markup, parse_mode='Markdown')
    except Exception as e:
        logger.error(
            f"Refresh leaderboard error for {telegram_id}: {e}", exc_info=True)
        await query.edit_message_text(
            "❌ Error refreshing leaderboard. Try `/start` or contact support.",
            parse_mode='Markdown'
        )


# Handlers
leaderboard_handler = CommandHandler('leaderboard', leaderboard_command)
refresh_leaderboard_button_handler = CallbackQueryHandler(
    refresh_leaderboard_handler, pattern='^refresh_leaderboard$')
