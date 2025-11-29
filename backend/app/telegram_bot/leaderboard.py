import asyncio
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CommandHandler, CallbackQueryHandler
from pathlib import Path
import json
from app.telegram_bot.utils import get_sui_client, load_user_session, get_walrus_client, get_key_manager
from datetime import datetime
import pytz
import os
import dotenv
from app.telegram_bot.checkin import checkin_manager


sui_client = get_sui_client()
walrus_client = get_walrus_client()
key_manager = get_key_manager()

Registry_id = os.getenv('COPILOT_REGISTRY_ID')


async def fetch_all_user_profiles_with_points():

    # === STEP 1: Try local encrypted files (fast) ===
    try:
        from secure_storage import load_and_decrypt
        from utils import load_user_session
        import asyncio

        sessions_dir = Path("user_sessions")
        profiles = []

        if sessions_dir.exists():
            for session_file in sessions_dir.glob("*.enc"):
                try:
                    session = load_and_decrypt(session_file)
                    if not session or 'telegram_id' not in session:
                        continue

                    uid = str(session['telegram_id'])
                    points = session.get('points', 0)
                    username = session.get('username', '')
                    telegram_username = session.get('telegram_username', '')
                    first_name = session.get('first_name', '')

                    if username and username not in ['User', 'Anonymous', '', None]:
                        display_name = username
                    elif telegram_username and telegram_username not in ['', None]:
                        display_name = f"@{telegram_username}"
                    elif first_name and first_name not in ['User', 'Anonymous']:
                        display_name = first_name
                    else:
                        display_name = f"User#{uid[-4:]}"

                    # Try to get more accurate points from checkin backup
                    checkin_file = Path("user_checkins") / f"{uid}.enc"
                    if checkin_file.exists() and session.get('password'):
                        from secure_storage import decrypt_data
                        blob = checkin_file.read_text()
                        data = decrypt_data(blob, uid, session['password'])
                        if isinstance(data, dict):
                            points = data.get('total', points)

                    profiles.append({
                        'profile_id': session.get('profile_id', 'local'),
                        'telegram_id': uid,
                        'username': display_name,
                        'points': int(points),
                        'last_checkin': session.get('last_checkin', 0),
                        'is_active': True
                    })
                except Exception as e:
                    continue

            if profiles:
                return profiles
    except Exception as e:
        pass

    # === STEP 2: Fallback to blockchain ===
    REGISTRY_ID = os.getenv('COPILOT_REGISTRY_ID')
    if not REGISTRY_ID:
        return []

    try:
        result = sui_client.client.get_object(REGISTRY_ID)
        if not result.is_ok():
            return []

        # FIX: Handle new pysui API
        data_obj = result.result_data
        content = data_obj.fields if hasattr(data_obj, 'fields') else data_obj.content
        registry_data = content.get('fields', {}) if isinstance(content, dict) else content
        users_map = registry_data.get('users', {}).get('fields', {}).get('contents', [])

        profiles = []
        for entry in users_map:
            profile_id = entry['value']
            try:
                profile_result = sui_client.client.get_object(profile_id)
                if not profile_result.is_ok():
                    continue

                p_data = profile_result.result_data
                p_content = p_data.fields if hasattr(p_data, 'fields') else p_data.content
                fields = p_content.get('fields', {}) if isinstance(p_content, dict) else p_content

                # Get telegram_id from blockchain
                telegram_id = str(fields.get('user_address', 'unknown'))

                # TRY TO GET USERNAME FROM LOCAL SESSION
                username = "User"
                try:
                    # Import here to avoid circular imports
                    from utils import load_user_session
                    session = await load_user_session(telegram_id, None)  # Pass None for context if needed
                    if session:
                        username_from_session = session.get('username', '')
                        first_name_from_session = session.get('first_name', '')

                        if username_from_session and username_from_session not in ['User', 'Anonymous', '', None]:
                            username = username_from_session
                        elif first_name_from_session and first_name_from_session not in ['User', 'Anonymous']:
                            username = first_name_from_session
                        else:
                            username = f"User#{telegram_id[-4:]}"
                except:
                    username = f"User#{telegram_id[-4:]}"

                profiles.append({
                    'profile_id': profile_id,
                    'telegram_id': telegram_id,
                    'username': username,  # ← NOW USING REAL USERNAMES
                    'points': int(fields.get('points', 0)),
                    'last_checkin': fields.get('last_checkin', 0),
                    'is_active': True
                })
            except Exception as e:
                continue

        return profiles

    except Exception as e:
        return []


async def get_user_rank_and_points(telegram_id, sorted_profiles):
    """
    Find user's rank and points in the sorted profiles list.
    """
    for rank, profile in enumerate(sorted_profiles, 1):
        if str(profile.get('telegram_id')) == str(telegram_id):
            return rank, profile.get('points', 0)

    # User not found in profiles
    return None, 0


async def format_leaderboard_text(sorted_profiles, user_rank, user_points, telegram_id, total_users):
    """Format leaderboard text using HTML formatting"""
    leaderboard_text = "<b>🏆 Leaderboard: Top Users</b>\n\n"
    leaderboard_text += f"<b>📊 Total Registered Users:</b> {total_users}\n\n"

    # Display top 10 users
    for i, profile in enumerate(sorted_profiles[:10], 1):
        # Use the username from the profile (which comes from session data)
        display_name = profile.get('username', f"User#{profile['telegram_id'][-4:]}")
        points = profile.get('points', 0)

        # Better rank display
        if i == 1:
            rank_display = "🥇 1st"
        elif i == 2:
            rank_display = "🥈 2nd"
        elif i == 3:
            rank_display = "🥉 3rd"
        else:
            rank_display = f"{i}th"

        # Clean up display name - HTML automatically handles underscores!
        if display_name.startswith('@'):
            display_name = display_name[1:]

        if len(display_name) > 15:
            display_name = display_name[:15] + "..."

        # Use HTML formatting instead of Markdown
        leaderboard_text += f"{rank_display} <b>{display_name}</b> - <code>{points}</code> points\n"

    leaderboard_text += f"\n{'─' * 30}\n"

    # Get the current user's display name from their profile
    current_user_profile = None
    for profile in sorted_profiles:
        if str(profile.get('telegram_id')) == str(telegram_id):
            current_user_profile = profile
            break

    if current_user_profile:
        user_display_name = current_user_profile.get('username', f"User#{telegram_id[-4:]}")

        if user_rank:
            if user_rank <= 10:
                leaderboard_text += f"<b>🎉 You're #{user_rank} - In the Top 10!</b>\n"
            elif user_rank <= 50:
                leaderboard_text += f"<b>📍 You're #{user_rank} - In the Top 50!</b>\n"
            else:
                leaderboard_text += f"<b>📍 Your Position:</b> #{user_rank}\n"

            leaderboard_text += f"<b>👤 User:</b> {user_display_name}\n"
            leaderboard_text += f"<b>⭐ Your Points:</b> {user_points}\n"

            # Show advancement info
            if user_rank > 1 and user_rank <= len(sorted_profiles):
                user_index = user_rank - 1
                if user_index > 0:
                    next_user_points = sorted_profiles[user_index - 1].get('points', 0)
                    points_needed = next_user_points - user_points + 1
                    if points_needed > 0:
                        leaderboard_text += f"<b>🎯 Need {points_needed} point(s) to advance!</b>\n"
    else:
        leaderboard_text += f"<b>📍 You're not on the leaderboard yet!</b>\n"
        leaderboard_text += f"<b>💡 Use</b> <code>/checkin</code> <b>daily to earn points!</b>\n"

    return leaderboard_text

async def leaderboard_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """
    Display the leaderboard with ranked users based on points.
    """
    telegram_id = str(update.effective_user.id)

    try:
        # Show loading message
        processing_msg = await update.message.reply_text(
            "🔄 Loading leaderboard...\n"
            "• Fetching user profiles...\n"
            "• Calculating rankings...\n\n"
            "This may take a few seconds..."
        )

        # Fetch all user profiles with updated points
        profiles = await fetch_all_user_profiles_with_points()

        if not profiles:
            await processing_msg.edit_text(
                "❌ **No users found!**\n\n"
                "The leaderboard is empty.\n"
                "Be the first to register with `/start`! 🎉"
            )
            return

        # Sort by points (descending)
        sorted_profiles = sorted(profiles, key=lambda x: x.get('points', 0), reverse=True)

        # Get user's rank and points
        user_rank, user_points = await get_user_rank_and_points(telegram_id, sorted_profiles)

        # ✅ FIXED: Pass telegram_id instead of Telegram username
        leaderboard_text = await format_leaderboard_text(
            sorted_profiles, user_rank, user_points, telegram_id, len(profiles)
        )

        # Create inline keyboard
        keyboard = [
            [InlineKeyboardButton("🔄 Refresh", callback_data='refresh_leaderboard')],
            [InlineKeyboardButton("✅ Check-in", callback_data='quick_checkin')]
        ]
        reply_markup = InlineKeyboardMarkup(keyboard)

        await processing_msg.edit_text(leaderboard_text, reply_markup=reply_markup, parse_mode='HTML')

    except Exception as e:
        error_msg = (
            "❌ **Error loading leaderboard**\n\n"
            "We encountered an issue fetching the rankings.\n\n"
            "✨ **Please try:**\n"
            "1. Wait a moment and use `/leaderboard` again\n"
            "2. Use `/start` to refresh your profile\n"
            "3. Contact support if this continues"
        )
        if 'processing_msg' in locals():
            await processing_msg.edit_text(error_msg, parse_mode='Markdown')
        else:
            await update.message.reply_text(error_msg, parse_mode='Markdown')


async def refresh_leaderboard_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """
    Handle the 'Refresh' button click to reload the leaderboard.
    """
    query = update.callback_query
    await query.answer()
    telegram_id = str(query.from_user.id)

    try:
        # Show loading state
        await query.edit_message_text("🔄 Refreshing leaderboard...")

        # Fetch updated profiles
        profiles = await fetch_all_user_profiles_with_points()

        if not profiles:
            await query.edit_message_text(
                "❌ **No users found!**\n\n"
                "The leaderboard is empty.\n"
                "Be the first to register with `/start`! 🎉"
            )
            return

        # Sort by points (descending)
        sorted_profiles = sorted(profiles, key=lambda x: x.get('points', 0), reverse=True)

        # Get user's updated rank and points
        user_rank, user_points = await get_user_rank_and_points(telegram_id, sorted_profiles)

        leaderboard_text = await format_leaderboard_text(
            sorted_profiles, user_rank, user_points, telegram_id, len(profiles)
        )

        # Update inline keyboard
        keyboard = [
            [InlineKeyboardButton("🔄 Refresh", callback_data='refresh_leaderboard')],
            [InlineKeyboardButton("✅ Check-in", callback_data='quick_checkin')]
        ]
        reply_markup = InlineKeyboardMarkup(keyboard)

        await query.edit_message_text(leaderboard_text, reply_markup=reply_markup, parse_mode='HTML')

    except Exception as e:
        error_msg = (
            "❌ **Error refreshing leaderboard**\n\n"
            "Please try again in a moment."
        )
        await query.edit_message_text(error_msg, parse_mode='Markdown')


async def quick_checkin_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """
    Handle quick check-in from leaderboard button.
    """
    query = update.callback_query
    await query.answer("Processing check-in...")

    user_id = str(query.from_user.id)
    username = query.from_user.username or query.from_user.first_name or "User"

    try:
        # Show processing message
        await query.edit_message_text(
            "🔄 Processing your check-in...\n\n"
            "Please wait while we process your daily check-in..."
        )

        # Directly call the checkin manager instead of importing
        result = await checkin_manager.process_check_in(user_id, context)

        # Show result
        await query.edit_message_text(result['message'], parse_mode='Markdown')

    except Exception as e:
        await query.edit_message_text(
            "❌ **Check-in Failed**\n\n"
            "Please use `/checkin` command directly or try again later."
        )


async def update_all_user_usernames(context: ContextTypes.DEFAULT_TYPE):
    """Force update usernames for all existing users"""
    from secure_storage import load_and_decrypt
    from utils import save_user_session
    import asyncio

    sessions_dir = Path("user_sessions")
    updated_count = 0

    if sessions_dir.exists():
        for session_file in sessions_dir.glob("*.enc"):
            try:
                session = load_and_decrypt(session_file)
                if not session or 'telegram_id' not in session:
                    continue

                telegram_id = session['telegram_id']

                # Skip if already has a proper username
                current_username = session.get('username', '')
                if current_username and current_username not in ['User', 'Anonymous', '']:
                    continue

                # Try to get user info from Telegram
                try:
                    # You'll need to store user first_names during registration
                    # For now, we can only update if we have first_name
                    first_name = session.get('first_name', '')
                    if first_name and first_name not in ['User', 'Anonymous']:
                        session['username'] = first_name
                        await save_user_session(telegram_id, session)
                        updated_count += 1
                except Exception as e:
                    pass

            except Exception as e:
                pass

    return updated_count

# Handlers
leaderboard_handler = CommandHandler('leaderboard', leaderboard_command)
refresh_leaderboard_button_handler = CallbackQueryHandler(refresh_leaderboard_handler, pattern='^refresh_leaderboard$')
quick_checkin_button_handler = CallbackQueryHandler(quick_checkin_handler, pattern='^quick_checkin$')