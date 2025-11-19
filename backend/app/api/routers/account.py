# app/api/routes/account.py
from fastapi import APIRouter, Depends, HTTPException
from app.db.session import get_supabase_client
from supabase import Client
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

# XP thresholds for each level


def get_xp_for_level(level: int) -> int:
    """Calculate total XP needed to reach a level"""
    # Formula: XP needed = 1000 * level^1.5
    # Level 1: 0 XP
    # Level 2: 2828 XP
    # Level 3: 5196 XP
    # Level 4: 8000 XP
    # Level 5: 11180 XP
    if level <= 1:
        return 0
    return int(1000 * (level ** 1.5))


def calculate_level_from_xp(xp: int) -> tuple[int, int, int]:
    """
    Returns (level, xp_for_current_level, xp_for_next_level)
    """
    level = 1
    while get_xp_for_level(level + 1) <= xp:
        level += 1

    current_level_xp = get_xp_for_level(level)
    next_level_xp = get_xp_for_level(level + 1)

    return level, current_level_xp, next_level_xp


@router.get("/account/{user_id}", summary="Get user account details")
async def get_account(user_id: str, db: Client = Depends(get_supabase_client)):
    try:
        if not user_id.strip():
            raise HTTPException(
                status_code=400, detail="User ID cannot be empty")

        # Get user profile
        result = db.table("user_profiles").select(
            "*").eq("user_id", user_id).execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="User not found")

        user = result.data[0]
        xp = user.get("xp", 0)

        # Calculate level and progress
        level, current_level_xp, next_level_xp = calculate_level_from_xp(xp)

        # Update level if it changed
        if user.get("level", 1) != level:
            db.table("user_profiles").update(
                {"level": level}).eq("user_id", user_id).execute()
            user["level"] = level

        # Get user's rank
        rank_query = db.rpc(
            'get_user_rank',
            {'target_user_id': user_id}
        ).execute()

        rank = rank_query.data if rank_query.data else None

        return {
            "user_id": user["user_id"],
            "wallet_address": user["wallet_address"],
            "email": user.get("email"),
            "username": user.get("username"),
            "first_name": user.get("first_name"),
            "last_name": user.get("last_name"),
            "xp": xp,
            "level": level,
            "current_level_xp": current_level_xp,
            "next_level_xp": next_level_xp,
            "points": user.get("points", 0),
            "referral_points": user.get("referral_points", 0),
            "rank": rank,
            "is_premium": user.get("is_premium", False),
            "created_at": user.get("created_at")
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching account: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/leaderboard", summary="Get top 100 users")
async def get_leaderboard(db: Client = Depends(get_supabase_client)):
    try:
        # Get top 100 users ordered by XP, then level, then points
        result = db.table("user_profiles").select(
            "user_id, wallet_address, username, email, xp, level, points, referral_points"
        ).order("xp", desc=True).order("level", desc=True).order("points", desc=True).limit(100).execute()

        if not result.data:
            return {"leaderboard": []}

        # Add rank to each user
        leaderboard = []
        for idx, user in enumerate(result.data):
            xp = user.get("xp", 0)
            level, current_level_xp, next_level_xp = calculate_level_from_xp(
                xp)

            leaderboard.append({
                "rank": idx + 1,
                "user_id": user["user_id"],
                "wallet_address": user["wallet_address"],
                "username": user.get("username"),
                "email": user.get("email"),
                "xp": xp,
                "level": level,
                "points": user.get("points", 0),
                "referral_points": user.get("referral_points", 0)
            })

        return {"leaderboard": leaderboard}

    except Exception as e:
        logger.error(f"Error fetching leaderboard: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/add-xp/{user_id}", summary="Add XP to user")
async def add_xp(user_id: str, xp_amount: int, db: Client = Depends(get_supabase_client)):
    """
    Add XP to a user and update their level automatically.
    This would typically be called after completing actions like posts, referrals, etc.
    """
    try:
        if not user_id.strip():
            raise HTTPException(
                status_code=400, detail="User ID cannot be empty")

        if xp_amount <= 0:
            raise HTTPException(
                status_code=400, detail="XP amount must be positive")

        # Get current user
        result = db.table("user_profiles").select(
            "xp, level").eq("user_id", user_id).execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="User not found")

        user = result.data[0]
        current_xp = user.get("xp", 0)
        new_xp = current_xp + xp_amount

        # Calculate new level
        new_level, _, _ = calculate_level_from_xp(new_xp)
        old_level = user.get("level", 1)

        # Update user
        update_result = db.table("user_profiles").update({
            "xp": new_xp,
            "level": new_level
        }).eq("user_id", user_id).execute()

        level_up = new_level > old_level

        return {
            "message": "XP added successfully",
            "user_id": user_id,
            "xp_added": xp_amount,
            "total_xp": new_xp,
            "level": new_level,
            "level_up": level_up,
            "levels_gained": new_level - old_level if level_up else 0
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adding XP: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")
