from fastapi import APIRouter, Depends, HTTPException
from app.schemas.waitlist import WaitlistEmail
from app.db.session import get_supabase_client
from supabase import Client
from datetime import datetime
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

@router.post("/waitlist", summary="Submit email to waitlist")
async def submit_waitlist(email_data: WaitlistEmail, db: Client = Depends(get_supabase_client)):
    try:
        existing = db.table("waitlist_emails").select("email").eq("email", email_data.email).execute()
        if existing.data:
            logger.warning(f"Duplicate email attempt: {email_data.email}")
            raise HTTPException(status_code=409, detail="This email is already registered on the waitlist")
        data = {
            "email": email_data.email,
            "created_at": datetime.utcnow().isoformat()
        }
        result = db.table("waitlist_emails").insert(data).execute()
        if result.data:
            logger.info(f"Email added to waitlist: {email_data.email}")
            return {"message": "Successfully added to waitlist!", "email": email_data.email}
        logger.error("Failed to insert email into Supabase")
        raise HTTPException(status_code=500, detail="Failed to add email to waitlist")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adding email to waitlist: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")