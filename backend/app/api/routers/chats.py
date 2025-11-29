# app/api/routes/chats.py
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from app.schemas.chat import ChatMessage, ChatUpdate, ChatListResponse, ChatMessageResponse, ChatResponseWithId
from app.db.session import get_supabase_client
from app.services.agents.base_agent import generate_ai_response_stream, generate_chat_name
from supabase import Client
from datetime import datetime
import logging
import json

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/chat/stream", summary="Submit chat message with streaming")
async def submit_chat_message_stream(message_data: ChatMessage, db: Client = Depends(get_supabase_client)):
    try:
        # --- Basic validation ---
        if not message_data.query.strip():
            logger.warning("Empty chat message received")
            raise HTTPException(
                status_code=400, detail="Chat message cannot be empty")

        chat_id = message_data.chat_id

        # --- Create new chat if necessary ---
        if not chat_id:
            if not message_data.user_id:
                logger.warning("No user_id provided for new chat")
                raise HTTPException(
                    status_code=400, detail="User ID required for new chat")

            # Generate intelligent chat name from first message
            chat_name = await generate_chat_name(message_data.query)

            chat_data = {
                "user_id": message_data.user_id,
                "name": chat_name,
                "created_at": datetime.utcnow().isoformat(),
                "last_updated": datetime.utcnow().isoformat(),
            }
            chat_result = db.table("chats").insert(chat_data).execute()
            if not chat_result.data:
                logger.error("Failed to create new chat session")
                raise HTTPException(
                    status_code=500, detail="Failed to create chat session")
            chat_id = chat_result.data[0]["chat_id"]
            logger.info(
                f"Created new chat session: {chat_id} with name: {chat_name}")

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
            raise HTTPException(
                status_code=500, detail="Failed to store chat message")

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
            {"role": "assistant" if m["sender"] ==
                "ai" else "user", "content": m["query"]}
            for m in reversed(context_result.data or [])
        ]

        # --- Stream AI response ---
        async def event_generator():
            full_response = ""
            chunk_count = 0

            # Send chat_id first
            yield f"data: {json.dumps({'type': 'chat_id', 'chat_id': chat_id})}\n\n"

            logger.info(f"Starting stream for query: {message_data.query}")
            logger.info(
                f"Is research query: {any(kw in message_data.query.lower() for kw in ['research', 'analyze', 'evaluate', 'investigate'])}")

            try:
                async for chunk in generate_ai_response_stream(
                    message_data.query,
                    context_messages,
                    message_data.user_id,
                ):
                    chunk_count += 1
                    logger.debug(
                        f"Stream chunk #{chunk_count}: {chunk.get('type', 'unknown')}")

                    if chunk["type"] == "response":
                        content = chunk["content"]
                        full_response += content
                        logger.debug(
                            f"Response chunk length: {len(content)}, Total: {len(full_response)}")
                        yield f"data: {json.dumps({'type': 'response', 'content': content})}\n\n"

                    elif chunk["type"] == "agent_info":
                        logger.info(
                            f"Agent info: {chunk.get('agent', 'Unknown')}")
                        yield f"data: {json.dumps({'type': 'agent_info', 'agent': chunk['agent'], 'cached': chunk.get('cached', False)})}\n\n"

                    elif chunk["type"] == "done":
                        logger.info(
                            f"Done event received. Total chunks: {chunk_count}, Response length: {len(full_response)}")
                        break

                # Verify we got content
                if not full_response:
                    logger.error(
                        "Stream completed but no response content was generated!")
                    error_msg = "  No response was generated. This might be a configuration issue. Please contact support."
                    yield f"data: {json.dumps({'type': 'response', 'content': error_msg})}\n\n"

                # Only store AI response if we have content
                if full_response:
                    ai_message = {
                        "chat_id": chat_id,
                        "query": full_response,
                        "user_id": message_data.user_id,
                        "sender": "ai",
                        "timestamp": datetime.utcnow().isoformat(),
                    }
                    db.table("chat_messages").insert(ai_message).execute()
                    logger.info(
                        f"Stored AI response: {len(full_response)} chars")
                else:
                    logger.warning(
                        "Skipping AI message storage - no content generated")

                # Update chat timestamp
                db.table("chats").update({"last_updated": datetime.utcnow().isoformat()}).eq(
                    "chat_id", chat_id).execute()

                # Always send done at the very end
                yield f"data: {json.dumps({'type': 'done'})}\n\n"
                logger.info(
                    f"Stream completed successfully. Total chunks: {chunk_count}")

            except Exception as e:
                logger.error(f"Error in event_generator: {e}", exc_info=True)
                yield f"data: {json.dumps({'type': 'response', 'content': f'Error: {str(e)}'})}\n\n"
                yield f"data: {json.dumps({'type': 'done'})}\n\n"

        return StreamingResponse(event_generator(), media_type="text/event-stream")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing chat message: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Internal server error: {str(e)}")

# Keep the original non-streaming endpoint for backwards compatibility


@router.post("/chat", summary="Submit chat message")
async def submit_chat_message(message_data: ChatMessage, db: Client = Depends(get_supabase_client)):
    try:
        # --- Basic validation ---
        if not message_data.query.strip():
            logger.warning("Empty chat message received")
            raise HTTPException(
                status_code=400, detail="Chat message cannot be empty")

        chat_id = message_data.chat_id

        # --- Create new chat if necessary ---
        if not chat_id:
            if not message_data.user_id:
                logger.warning("No user_id provided for new chat")
                raise HTTPException(
                    status_code=400, detail="User ID required for new chat")

            # Generate intelligent chat name from first message
            chat_name = await generate_chat_name(message_data.query)

            chat_data = {
                "user_id": message_data.user_id,
                "name": chat_name,
                "created_at": datetime.utcnow().isoformat(),
                "last_updated": datetime.utcnow().isoformat(),
            }
            chat_result = db.table("chats").insert(chat_data).execute()
            if not chat_result.data:
                logger.error("Failed to create new chat session")
                raise HTTPException(
                    status_code=500, detail="Failed to create chat session")
            chat_id = chat_result.data[0]["chat_id"]
            logger.info(
                f"Created new chat session: {chat_id} with name: {chat_name}")

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
            raise HTTPException(
                status_code=500, detail="Failed to store chat message")

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
            {"role": "assistant" if m["sender"] ==
                "ai" else "user", "content": m["query"]}
            for m in reversed(context_result.data or [])
        ]

        # --- Generate AI response (non-streaming) ---
        full_response = ""
        async for chunk in generate_ai_response_stream(
            message_data.query,
            context_messages,
            message_data.user_id,
        ):
            if chunk["type"] == "response":
                full_response += chunk["content"]

        ai_response_text = full_response

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
            raise HTTPException(
                status_code=500, detail="Failed to store AI response")

        # --- Update chat timestamp ---
        db.table("chats").update({"last_updated": datetime.utcnow().isoformat()}).eq(
            "chat_id", chat_id).execute()

        logger.info(
            f"Chat message processed successfully for chat_id: {chat_id}")
        return {"response": ai_response_text, "chat_id": chat_id}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing chat message: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/chat/{chat_id}", summary="Get chat history")
async def get_chat_history(chat_id: str, db: Client = Depends(get_supabase_client)):
    try:
        chat_check = db.table("chats").select(
            "chat_id").eq("chat_id", chat_id).execute()
        if not chat_check.data:
            logger.warning(f"Chat not found: {chat_id}")
            raise HTTPException(
                status_code=404, detail="Chat session not found")
        result = db.table("chat_messages").select(
            "*").eq("chat_id", chat_id).order("timestamp", desc=False).execute()
        if not result.data:
            logger.info(f"No messages found for chat_id: {chat_id}")
            return {"messages": [], "chat_id": chat_id}
        logger.info(
            f"Retrieved {len(result.data)} messages for chat_id: {chat_id}")
        return {"messages": result.data, "chat_id": chat_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving chat history: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/chats", summary="Get user chats")
async def get_user_chats(user_id: str, db: Client = Depends(get_supabase_client)):
    try:
        result = db.table("chats").select("chat_id, name, created_at, last_updated").eq(
            "user_id", user_id).order("last_updated", desc=True).execute()
        if not result.data:
            logger.info(f"No chats found for user_id: {user_id}")
            return {"chats": []}
        logger.info(
            f"Retrieved {len(result.data)} chats for user_id: {user_id}")
        return {"chats": result.data}
    except Exception as e:
        logger.error(f"Error retrieving chats: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Internal server error: {str(e)}")


@router.patch("/chat/{chat_id}", summary="Update chat name")
async def update_chat_name(chat_id: str, chat_update: ChatUpdate, db: Client = Depends(get_supabase_client)):
    try:
        if not chat_update.name.strip():
            logger.warning("Empty chat name received")
            raise HTTPException(
                status_code=400, detail="Chat name cannot be empty")
        chat_check = db.table("chats").select(
            "chat_id").eq("chat_id", chat_id).execute()
        if not chat_check.data:
            logger.warning(f"Chat not found: {chat_id}")
            raise HTTPException(
                status_code=404, detail="Chat session not found")
        update_data = {
            "name": chat_update.name,
            "last_updated": datetime.utcnow().isoformat()
        }
        result = db.table("chats").update(
            update_data).eq("chat_id", chat_id).execute()
        if not result.data:
            logger.error(f"Failed to update chat name for chat_id: {chat_id}")
            raise HTTPException(
                status_code=500, detail="Failed to update chat name")
        logger.info(f"Chat name updated for chat_id: {chat_id}")
        return {"message": "Chat name updated successfully", "chat_id": chat_id, "name": chat_update.name}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating chat name: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/chat/{chat_id}", summary="Delete chat and its messages")
async def delete_chat(chat_id: str, db: Client = Depends(get_supabase_client)):
    try:
        chat_check = db.table("chats").select(
            "chat_id").eq("chat_id", chat_id).execute()
        if not chat_check.data:
            logger.warning(f"Chat not found: {chat_id}")
            raise HTTPException(
                status_code=404, detail="Chat session not found")
        messages_result = db.table("chat_messages").delete().eq(
            "chat_id", chat_id).execute()
        chat_result = db.table("chats").delete().eq(
            "chat_id", chat_id).execute()
        if not chat_result.data:
            logger.error(f"Failed to delete chat for chat_id: {chat_id}")
            raise HTTPException(
                status_code=500, detail="Failed to delete chat")
        logger.info(
            f"Chat deleted for chat_id: {chat_id}, deleted {len(messages_result.data or [])} messages")
        return {"message": "Chat deleted successfully", "chat_id": chat_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting chat: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Internal server error: {str(e)}")
