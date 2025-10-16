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

# Load environment variables
load_dotenv()

# Initialize FastAPI app
app = FastAPI(
    title="Tovira API",
    description="API for handling waitlist email submissions, chat messages, and user profile management",
    version="1.0.0"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "https://tovira.xyz",
        "https://www.tovira.xyz",
        "https://tovira.onrender.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Supabase configuration
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    logger.error("Missing SUPABASE_URL or SUPABASE_KEY in .env file")
    raise ValueError("SUPABASE_URL and SUPABASE_KEY must be set in the .env file")

try:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    logger.info("Supabase client initialized successfully")
except Exception as e:
    logger.error(f"Failed to initialize Supabase client: {str(e)}")
    raise ValueError(f"Failed to initialize Supabase client: {str(e)}")

# Pydantic models
class WaitlistEmail(BaseModel):
    email: EmailStr

class ChatMessage(BaseModel):
    query: str
    user_id: str | None
    chat_id: str | None = None

class UserUpdate(BaseModel):
    user_id: str
    wallet_address: str
    email: EmailStr | None = None
    username: str | None = None
    first_name: str | None = None
    last_name: str | None = None

class UserCheck(BaseModel):
    user_id: str

class ChatUpdate(BaseModel):
    name: str

@app.get("/api/check-user", summary="Check if user exists")
async def check_user(user_id: str):
    try:
        if not user_id.strip():
            logger.warning("Empty user_id received")
            raise HTTPException(status_code=400, detail="User ID cannot be empty")
        result = supabase.table("users").select("user_id").eq("user_id", user_id).execute()
        if result.data:
            logger.info(f"User found: {user_id}")
            return {"exists": True, "user_id": user_id}
        logger.info(f"User not found: {user_id}")
        return {"exists": False, "user_id": user_id}
    except Exception as e:
        logger.error(f"Error checking user: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post("/api/update-user", summary="Update user profile")
async def update_user(user_data: UserUpdate):
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
        user_result = supabase.table("users").upsert(user_record, on_conflict="user_id").execute()
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
        profile_result = supabase.table("user_profiles").upsert(profile_record, on_conflict="user_id").execute()
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

@app.post("/waitlist", summary="Submit email to waitlist")
async def submit_waitlist(email_data: WaitlistEmail):
    try:
        existing = supabase.table("waitlist_emails").select("email").eq("email", email_data.email).execute()
        if existing.data:
            logger.warning(f"Duplicate email attempt: {email_data.email}")
            raise HTTPException(status_code=409, detail="This email is already registered on the waitlist")
        data = {
            "email": email_data.email,
            "created_at": datetime.utcnow().isoformat()
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

@app.post("/api/chat", summary="Submit chat message")
async def submit_chat_message(message_data: ChatMessage):
    try:
        if not message_data.query.strip():
            logger.warning("Empty chat message received")
            raise HTTPException(status_code=400, detail="Chat message cannot be empty")
        chat_id = message_data.chat_id
        if not chat_id:
            if not message_data.user_id:
                logger.warning("No user_id provided for new chat")
                raise HTTPException(status_code=400, detail="User ID required for new chat")
            chat_data = {
                "user_id": message_data.user_id,
                "name": "Untitled",
                "created_at": datetime.utcnow().isoformat(),
                "last_updated": datetime.utcnow().isoformat()
            }
            chat_result = supabase.table("chats").insert(chat_data).execute()
            if not chat_result.data:
                logger.error("Failed to create new chat session")
                raise HTTPException(status_code=500, detail="Failed to create chat session")
            chat_id = chat_result.data[0]["chat_id"]
            logger.info(f"Created new chat session: {chat_id}")
        user_message = {
            "chat_id": chat_id,
            "query": message_data.query,
            "user_id": message_data.user_id,
            "sender": "user",
            "timestamp": datetime.utcnow().isoformat()
        }
        result = supabase.table("chat_messages").insert(user_message).execute()
        if not result.data:
            logger.error("Failed to insert chat message into Supabase")
            raise HTTPException(status_code=500, detail="Failed to store chat message")
        ai_response_text = f"I got your query! Here's a sample response about {message_data.query}"
        ai_message = {
            "chat_id": chat_id,
            "query": ai_response_text,
            "user_id": message_data.user_id,
            "sender": "ai",
            "timestamp": datetime.utcnow().isoformat()
        }
        ai_result = supabase.table("chat_messages").insert(ai_message).execute()
        if not ai_result.data:
            logger.error("Failed to insert AI response into Supabase")
            raise HTTPException(status_code=500, detail="Failed to store AI response")
        supabase.table("chats").update({"last_updated": datetime.utcnow().isoformat()}).eq("chat_id", chat_id).execute()
        logger.info(f"Chat message processed for chat_id: {chat_id}")
        return {"response": ai_response_text, "chat_id": chat_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing chat message: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get("/api/chat/{chat_id}", summary="Get chat history")
async def get_chat_history(chat_id: str):
    try:
        chat_check = supabase.table("chats").select("chat_id").eq("chat_id", chat_id).execute()
        if not chat_check.data:
            logger.warning(f"Chat not found: {chat_id}")
            raise HTTPException(status_code=404, detail="Chat session not found")
        result = supabase.table("chat_messages").select("*").eq("chat_id", chat_id).order("timestamp", desc=False).execute()
        if not result.data:
            logger.info(f"No messages found for chat_id: {chat_id}")
            return {"messages": [], "chat_id": chat_id}
        logger.info(f"Retrieved {len(result.data)} messages for chat_id: {chat_id}")
        return {"messages": result.data, "chat_id": chat_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving chat history: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get("/api/chats", summary="Get user chats")
async def get_user_chats(user_id: str):
    try:
        result = supabase.table("chats").select("chat_id, name, created_at, last_updated").eq("user_id", user_id).order("last_updated", desc=True).execute()
        if not result.data:
            logger.info(f"No chats found for user_id: {user_id}")
            return {"chats": []}
        logger.info(f"Retrieved {len(result.data)} chats for user_id: {user_id}")
        return {"chats": result.data}
    except Exception as e:
        logger.error(f"Error retrieving chats: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.patch("/api/chat/{chat_id}", summary="Update chat name")
async def update_chat_name(chat_id: str, chat_update: ChatUpdate):
    try:
        if not chat_update.name.strip():
            logger.warning("Empty chat name received")
            raise HTTPException(status_code=400, detail="Chat name cannot be empty")
        chat_check = supabase.table("chats").select("chat_id").eq("chat_id", chat_id).execute()
        if not chat_check.data:
            logger.warning(f"Chat not found: {chat_id}")
            raise HTTPException(status_code=404, detail="Chat session not found")
        update_data = {
            "name": chat_update.name,
            "last_updated": datetime.utcnow().isoformat()
        }
        result = supabase.table("chats").update(update_data).eq("chat_id", chat_id).execute()
        if not result.data:
            logger.error(f"Failed to update chat name for chat_id: {chat_id}")
            raise HTTPException(status_code=500, detail="Failed to update chat name")
        logger.info(f"Chat name updated for chat_id: {chat_id}")
        return {"message": "Chat name updated successfully", "chat_id": chat_id, "name": chat_update.name}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating chat name: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.delete("/api/chat/{chat_id}", summary="Delete chat and its messages")
async def delete_chat(chat_id: str):
    try:
        chat_check = supabase.table("chats").select("chat_id").eq("chat_id", chat_id).execute()
        if not chat_check.data:
            logger.warning(f"Chat not found: {chat_id}")
            raise HTTPException(status_code=404, detail="Chat session not found")
        # Delete chat messages
        messages_result = supabase.table("chat_messages").delete().eq("chat_id", chat_id).execute()
        # Delete chat
        chat_result = supabase.table("chats").delete().eq("chat_id", chat_id).execute()
        if not chat_result.data:
            logger.error(f"Failed to delete chat for chat_id: {chat_id}")
            raise HTTPException(status_code=500, detail="Failed to delete chat")
        logger.info(f"Chat deleted for chat_id: {chat_id}, deleted {len(messages_result.data or [])} messages")
        return {"message": "Chat deleted successfully", "chat_id": chat_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting chat: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get("/health", summary="Health check")
async def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="localhost", port=8000)