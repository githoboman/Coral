# app/api/routes/users.py
from fastapi import APIRouter, Depends, HTTPException
from app.schemas.user import UserUpdate, UserCheck
from app.db.session import get_supabase_client
from supabase import Client
from datetime import datetime
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

@router.get("/check-user", summary="Check if user exists")
async def check_user(user_id: str, db: Client = Depends(get_supabase_client)):
    try:
        if not user_id.strip():
            logger.warning("Empty user_id received")
            raise HTTPException(status_code=400, detail="User ID cannot be empty")
        result = db.table("users").select("user_id").eq("user_id", user_id).execute()
        if result.data:
            logger.info(f"User found: {user_id}")
            return {"exists": True, "user_id": user_id}
        logger.info(f"User not found: {user_id}")
        return {"exists": False, "user_id": user_id}
    except Exception as e:
        logger.error(f"Error checking user: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@router.post("/update-user", summary="Update user profile")
async def update_user(user_data: UserUpdate, db: Client = Depends(get_supabase_client)):
    try:
        if not user_data.user_id.strip():
            logger.warning("Empty user_id received")
            raise HTTPException(status_code=400, detail="User ID cannot be empty")
        user_record = {
            "user_id": user_data.user_id,
            "email": user_data.email,
            "wallet": user_data.wallet_address,
            "is_premium": False,
            "created_at": datetime.utcnow().isoformat()
        }
        user_result = db.table("users").upsert(user_record, on_conflict="user_id").execute()
        if not user_result.data:
            logger.error("Failed to upsert user into users table")
            raise HTTPException(status_code=500, detail="Failed to update users table")
        profile_record = {
            "user_id": user_data.user_id,
            "username": user_data.username,
            "first_name": user_data.first_name,
            "last_name": user_data.last_name,
            "wallet_address": user_data.wallet_address,
            "created_at": datetime.utcnow().isoformat(),
            "last_active": datetime.utcnow().isoformat(),
            "preferences": {},
            "timezone": "UTC",
            "is_premium": False,
            "points": 0,
            "last_checkin": None,
            "referral_code": None,
            "x_handle": None,
            "discord_handle": None,
            "daily_post_count": 0,
            "last_post_date": None
        }
        profile_result = db.table("user_profiles").upsert(profile_record, on_conflict="user_id").execute()
        if not profile_result.data:
            logger.error("Failed to upsert user into user_profiles table")
            raise HTTPException(status_code=500, detail="Failed to update user_profiles table")
        logger.info(f"User profile updated for user_id: {user_data.user_id}")
        return {"message": "User profile updated successfully", "user_id": user_data.user_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating user profile: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")