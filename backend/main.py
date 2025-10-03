from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from supabase import create_client, Client
from datetime import datetime
from dotenv import load_dotenv
import os
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables from .env file
load_dotenv()

# Initialize FastAPI app
app = FastAPI(
    title="Tovira Waitlist API",
    description="API for handling waitlist email submissions",
    version="1.0.0"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Allow local development
        "https://tovira.xyz",  # Add your production frontend URL
        "https://www.tovira.xyz",
        "https://tovira.onrender.com/",
    ],
    allow_credentials=True,
    allow_methods=["*"],  # Allow all HTTP methods (GET, POST, OPTIONS, etc.)
    allow_headers=["*"],  # Allow all headers
)

# Supabase configuration
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

# Validate environment variables
if not SUPABASE_URL or not SUPABASE_KEY:
    logger.error("Missing SUPABASE_URL or SUPABASE_KEY in .env file")
    raise ValueError("SUPABASE_URL and SUPABASE_KEY must be set in the .env file")

try:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    logger.info("Supabase client initialized successfully")
except Exception as e:
    logger.error(f"Failed to initialize Supabase client: {str(e)}")
    raise ValueError(f"Failed to initialize Supabase client: {str(e)}")

class WaitlistEmail(BaseModel):
    email: EmailStr  # Validate email format

@app.post("/waitlist", summary="Submit email to waitlist", response_description="Email submitted successfully")
async def submit_waitlist(email_data: WaitlistEmail):
    """
    Endpoint to add an email to the waitlist.

    - **email**: The email address to subscribe to the waitlist (must be a valid email format).
    """
    try:
        # Check if email already exists
        existing = supabase.table("waitlist_emails").select("email").eq("email", email_data.email).execute()
        if existing.data:
            logger.warning(f"Duplicate email attempt: {email_data.email}")
            raise HTTPException(status_code=409, detail="This email is already registered on the waitlist")

        # Insert the email into Supabase
        data = {
            "email": email_data.email,
            "created_at": datetime.utcnow().isoformat()  # ISO format for Supabase
        }
        result = supabase.table("waitlist_emails").insert(data).execute()

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

@app.get("/health", summary="Health check", response_description="API health status")
async def health_check():
    """
    Endpoint to check the health of the API.
    """
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)