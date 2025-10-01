from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from supabase import create_client, Client
from typing import Optional
import os
from dotenv import load_dotenv
from datetime import datetime

# Load environment variables from .env file
load_dotenv()

# Initialize FastAPI app
app = FastAPI(title="Tovira Waitlist API", description="API for handling waitlist email submissions", version="1.0.0")

# Supabase configuration
# Get the token and API keys from environment variables
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

# Check if required tokens are loaded
if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError('SUPABASE_URL and SUPABASE_KEY must be set')
    
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

class WaitlistEmail(BaseModel):
    email: str

@app.post("/waitlist", summary="Submit email to waitlist", response_description="Email submitted successfully")
async def submit_waitlist(email_data: WaitlistEmail):
    """
    Endpoint to add an email to the waitlist.
    
    - **email**: The email address to subscribe to the waitlist.
    """
    try:
        # Check if email already exists (optional, to avoid duplicates)
        existing = supabase.table("waitlist_emails").select("email").eq("email", email_data.email).execute()
        if existing.data:
            raise HTTPException(status_code=409, detail="Email already on waitlist")

        # Insert the email into Supabase
        data = {
            "email": email_data.email,
            "created_at": datetime.utcnow()
        }
        result = supabase.table("waitlist_emails").insert(data).execute()

        if result.data:
            return {"message": "Successfully added to waitlist!", "email": email_data.email}
        else:
            raise HTTPException(status_code=500, detail="Failed to add email")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get("/health", summary="Health check")
async def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)