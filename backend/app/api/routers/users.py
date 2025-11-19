# app/api/routes/users.py
from fastapi import APIRouter, Depends, HTTPException
from app.schemas.user import UserUpdate, UserOnboard
from app.db.session import get_supabase_client
from supabase import Client
from datetime import datetime
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/fetch-user", summary="Fetch user profile")
async def fetch_user(user_id: str, db: Client = Depends(get_supabase_client)):
    try:
        if not user_id.strip():
            logger.warning("Empty user_id received")
            raise HTTPException(
                status_code=400, detail="User ID cannot be empty")

        result = db.table("user_profiles").select(
            "*").eq("user_id", user_id).execute()

        if result.data:
            logger.info(f"User found: {user_id}")
            user_data = result.data[0]
            # Check if user is onboarded (has email)
            is_onboarded = bool(user_data.get("email"))
            return {
                "exists": True,
                "user": user_data,
                "is_onboarded": is_onboarded
            }

        logger.info(f"User not found: {user_id}")
        return {"exists": False, "user": None, "is_onboarded": False}

    except Exception as e:
        logger.error(f"Error fetching user: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/onboard-user", summary="Onboard user with email")
async def onboard_user(onboard_data: UserOnboard, db: Client = Depends(get_supabase_client)):
    try:
        if not onboard_data.user_id.strip():
            logger.warning("Empty user_id received")
            raise HTTPException(
                status_code=400, detail="User ID cannot be empty")

        if not onboard_data.email.strip():
            logger.warning("Empty email received")
            raise HTTPException(
                status_code=400, detail="Email cannot be empty")

        # Check if email exists in waitlist
        waitlist_result = db.table("waitlist_emails").select(
            "email").eq("email", onboard_data.email).execute()

        if not waitlist_result.data:
            logger.warning(
                f"Email not found in waitlist: {onboard_data.email}")
            raise HTTPException(
                status_code=404,
                detail="Email not found in waitlist. Please join our waitlist first."
            )

        # Check if email is already used by another account
        existing_user = db.table("user_profiles").select(
            "user_id").eq("email", onboard_data.email).execute()

        if existing_user.data and existing_user.data[0]["user_id"] != onboard_data.user_id:
            logger.warning(f"Email already in use: {onboard_data.email}")
            raise HTTPException(
                status_code=409,
                detail="An account with this email already exists."
            )

        # Update user profile with email and other optional data
        update_data = {
            "user_id": onboard_data.user_id,
            "email": onboard_data.email,
            "last_active": datetime.utcnow().isoformat(),
        }

        # Add optional fields if provided
        if onboard_data.username:
            update_data["username"] = onboard_data.username
        if onboard_data.first_name:
            update_data["first_name"] = onboard_data.first_name
        if onboard_data.last_name:
            update_data["last_name"] = onboard_data.last_name

        result = db.table("user_profiles").update(update_data).eq(
            "user_id", onboard_data.user_id).execute()

        if not result.data:
            logger.error(f"Failed to onboard user: {onboard_data.user_id}")
            raise HTTPException(
                status_code=500, detail="Failed to complete onboarding")

        logger.info(f"User onboarded successfully: {onboard_data.user_id}")
        return {
            "message": "Onboarding completed successfully!",
            "user_id": onboard_data.user_id,
            "email": onboard_data.email
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error onboarding user: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/update-user", summary="Update or create user profile")
async def update_user(user_data: UserUpdate, db: Client = Depends(get_supabase_client)):
    try:
        if not user_data.user_id.strip():
            logger.warning("Empty user_id received")
            raise HTTPException(
                status_code=400, detail="User ID cannot be empty")

        # Build profile record for initial user creation (without email)
        profile_record = {
            "user_id": user_data.user_id,
            "wallet_address": user_data.wallet_address,
            "is_premium": False,
            "points": 0,
            "daily_post_count": 0,
            "preferences": {},
            "timezone": "UTC",
            "created_at": datetime.utcnow().isoformat(),
            "last_active": datetime.utcnow().isoformat(),
        }

        # Upsert into user_profiles
        result = db.table("user_profiles").upsert(
            profile_record,
            on_conflict="user_id"
        ).execute()

        if not result.data:
            logger.error(
                f"Failed to upsert user profile for user_id: {user_data.user_id}")
            raise HTTPException(
                status_code=500, detail="Failed to update user profile")

        logger.info(
            f"User profile updated/created for user_id: {user_data.user_id}")
        return {
            "message": "User profile created successfully",
            "user_id": user_data.user_id,
            "requires_onboarding": True
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating user profile: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")
