# app/api/routes/chats.py
from fastapi import APIRouter, Depends, HTTPException
from app.schemas.chat import ChatMessage, ChatUpdate, ChatListResponse, ChatMessageResponse, ChatResponseWithId
from app.db.session import get_supabase_client
from app.services.agents.base_agent import generate_ai_response
from supabase import Client
from datetime import datetime
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

@router.post("/chat", summary="Submit chat message")
async def submit_chat_message(message_data: ChatMessage, db: Client = Depends(get_supabase_client)):
    try:
        # --- Basic validation ---
        if not message_data.query.strip():
            logger.warning("Empty chat message received")
            raise HTTPException(status_code=400, detail="Chat message cannot be empty")

        chat_id = message_data.chat_id

        # --- Create new chat if necessary ---
        if not chat_id:
            if not message_data.user_id:
                logger.warning("No user_id provided for new chat")
                raise HTTPException(status_code=400, detail="User ID required for new chat")

            chat_data = {
                "user_id": message_data.user_id,
                "name": "Untitled",
                "created_at": datetime.utcnow().isoformat(),
                "last_updated": datetime.utcnow().isoformat(),
            }
            chat_result = db.table("chats").insert(chat_data).execute()
            if not chat_result.data:
                logger.error("Failed to create new chat session")
                raise HTTPException(status_code=500, detail="Failed to create chat session")
            chat_id = chat_result.data[0]["chat_id"]
            logger.info(f"Created new chat session: {chat_id}")

        # --- Store user message ---
        user_message = {
            "chat_id": chat_id,
            "query": message_data.query,
            "user_id": message_data.user_id,
            "sender": "user",
            "timestamp": datetime.utcnow().isoformat(),
        }
        result = db.table("chat_messages").insert(user_message).execute()
        if not result.data:
            logger.error("Failed to insert chat message into Supabase")
            raise HTTPException(status_code=500, detail="Failed to store chat message")

        # --- Fetch context (last 5 messages) ---
        context_result = (
            db.table("chat_messages")
            .select("sender, query")
            .eq("chat_id", chat_id)
            .order("timestamp", desc=True)
            .limit(5)
            .execute()
        )
        context_messages = [
            {"role": "assistant" if m["sender"] == "ai" else "user", "content": m["query"]}
            for m in reversed(context_result.data or [])
        ]

        # --- Generate AI response ---
        ai_response_text = await generate_ai_response(message_data.query, context_messages)

        # --- Store AI response ---
        ai_message = {
            "chat_id": chat_id,
            "query": ai_response_text,
            "user_id": message_data.user_id,
            "sender": "ai",
            "timestamp": datetime.utcnow().isoformat(),
        }
        ai_result = db.table("chat_messages").insert(ai_message).execute()
        if not ai_result.data:
            logger.error("Failed to insert AI response into Supabase")
            raise HTTPException(status_code=500, detail="Failed to store AI response")

        # --- Update chat timestamp ---
        db.table("chats").update({"last_updated": datetime.utcnow().isoformat()}).eq("chat_id", chat_id).execute()

        logger.info(f"Chat message processed successfully for chat_id: {chat_id}")
        return {"response": ai_response_text, "chat_id": chat_id}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing chat message: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@router.get("/chat/{chat_id}", summary="Get chat history")
async def get_chat_history(chat_id: str, db: Client = Depends(get_supabase_client)):
    try:
        chat_check = db.table("chats").select("chat_id").eq("chat_id", chat_id).execute()
        if not chat_check.data:
            logger.warning(f"Chat not found: {chat_id}")
            raise HTTPException(status_code=404, detail="Chat session not found")
        result = db.table("chat_messages").select("*").eq("chat_id", chat_id).order("timestamp", desc=False).execute()
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

@router.get("/chats", summary="Get user chats")
async def get_user_chats(user_id: str, db: Client = Depends(get_supabase_client)):
    try:
        result = db.table("chats").select("chat_id, name, created_at, last_updated").eq("user_id", user_id).order("last_updated", desc=True).execute()
        if not result.data:
            logger.info(f"No chats found for user_id: {user_id}")
            return {"chats": []}
        logger.info(f"Retrieved {len(result.data)} chats for user_id: {user_id}")
        return {"chats": result.data}
    except Exception as e:
        logger.error(f"Error retrieving chats: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@router.patch("/chat/{chat_id}", summary="Update chat name")
async def update_chat_name(chat_id: str, chat_update: ChatUpdate, db: Client = Depends(get_supabase_client)):
    try:
        if not chat_update.name.strip():
            logger.warning("Empty chat name received")
            raise HTTPException(status_code=400, detail="Chat name cannot be empty")
        chat_check = db.table("chats").select("chat_id").eq("chat_id", chat_id).execute()
        if not chat_check.data:
            logger.warning(f"Chat not found: {chat_id}")
            raise HTTPException(status_code=404, detail="Chat session not found")
        update_data = {
            "name": chat_update.name,
            "last_updated": datetime.utcnow().isoformat()
        }
        result = db.table("chats").update(update_data).eq("chat_id", chat_id).execute()
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

@router.delete("/chat/{chat_id}", summary="Delete chat and its messages")
async def delete_chat(chat_id: str, db: Client = Depends(get_supabase_client)):
    try:
        chat_check = db.table("chats").select("chat_id").eq("chat_id", chat_id).execute()
        if not chat_check.data:
            logger.warning(f"Chat not found: {chat_id}")
            raise HTTPException(status_code=404, detail="Chat session not found")
        messages_result = db.table("chat_messages").delete().eq("chat_id", chat_id).execute()
        chat_result = db.table("chats").delete().eq("chat_id", chat_id).execute()
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