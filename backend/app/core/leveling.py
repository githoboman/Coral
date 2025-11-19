# app/core/leveling.py
"""
Leveling System Configuration

This module defines how the XP and leveling system works in the application.
"""

# XP Formula: XP needed for level N = 1000 * N^1.5
# This creates a smooth progression that gets harder but not exponentially difficult

# XP Rewards for different actions
XP_REWARDS = {
    "daily_checkin": 50,
    "create_post": 100,
    "receive_like": 10,
    "receive_comment": 20,
    "complete_profile": 200,
    "first_post": 300,
    "verify_email": 150,
    "add_social_media": 75,
    "refer_friend": 500,  # When referred friend signs up
    "streak_7_days": 350,
    "streak_30_days": 1500,
    "premium_subscription": 1000,
}

# Points can be different from XP - points might be used for rewards/shop
POINTS_REWARDS = {
    "daily_checkin": 10,
    "create_post": 25,
    "receive_like": 2,
    "receive_comment": 5,
    "refer_friend": 100,
    "streak_7_days": 75,
    "streak_30_days": 300,
}


def get_xp_for_level(level: int) -> int:
    """
    Calculate total XP needed to reach a specific level.
    
    Formula: XP = 1000 * level^1.5
    
    Level progression:
    - Level 1: 0 XP (starting level)
    - Level 2: 2,828 XP
    - Level 3: 5,196 XP
    - Level 4: 8,000 XP
    - Level 5: 11,180 XP
    - Level 10: 31,622 XP
    - Level 20: 89,442 XP
    - Level 50: 353,553 XP
    - Level 100: 1,000,000 XP
    """
    if level <= 1:
        return 0
    return int(1000 * (level ** 1.5))


def calculate_level_from_xp(xp: int) -> tuple[int, int, int]:
    """
    Calculate level and progress from total XP.
    
    Returns:
        tuple: (current_level, xp_for_current_level, xp_for_next_level)
    
    Example:
        >>> calculate_level_from_xp(3000)
        (2, 2828, 5196)
        
        This means: Level 2, need 2828 XP to reach level 2 (already passed),
        need 5196 XP to reach level 3
    """
    level = 1
    while get_xp_for_level(level + 1) <= xp:
        level += 1

    current_level_xp = get_xp_for_level(level)
    next_level_xp = get_xp_for_level(level + 1)

    return level, current_level_xp, next_level_xp


def get_level_progress(xp: int) -> dict:
    """
    Get detailed level progress information.
    
    Returns:
        dict: {
            'level': current level,
            'xp': total XP,
            'xp_in_level': XP earned in current level,
            'xp_needed': XP needed to reach next level,
            'progress_percentage': Progress to next level as percentage
        }
    """
    level, current_level_xp, next_level_xp = calculate_level_from_xp(xp)
    xp_in_level = xp - current_level_xp
    xp_needed = next_level_xp - current_level_xp
    progress = (xp_in_level / xp_needed) * 100 if xp_needed > 0 else 0

    return {
        'level': level,
        'xp': xp,
        'xp_in_level': xp_in_level,
        'xp_needed_for_next': xp_needed,
        'progress_percentage': round(progress, 2)
    }


# Example usage in your action handlers:
"""
# When a user creates a post
from app.config.leveling import XP_REWARDS, POINTS_REWARDS

async def create_post(user_id: str, db: Client):
    # ... create post logic ...
    
    # Award XP and points
    xp_to_add = XP_REWARDS["create_post"]
    points_to_add = POINTS_REWARDS["create_post"]
    
    # Call the add_xp endpoint or update directly
    await add_xp_and_points(user_id, xp_to_add, points_to_add, db)
"""
