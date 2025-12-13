from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Body
from fastapi.responses import StreamingResponse, JSONResponse
from supabase import Client
from typing import Optional, Dict, Any
from datetime import datetime
import logging
import json

from app.db.session import get_supabase_client
from app.schemas.chat import ChatMessage
from app.schemas.agent import AgentType, IntentType, RouterResponse

# Services
from app.services.vector_store import VectorStoreService
from app.services.agents.base_agent import ToviraAgent      # Main Agent
from app.services.agents.router_agent import RouterAgent    # Router
from app.services.agents.research_agent import ResearchAgentSimple # Research
from app.services.agents.task_agent import TaskAgent        # Task
from app.services.agents.alerts_agent import alerts_agent_tool_async  # Alert

router = APIRouter()
logger = logging.getLogger(__name__)

# --- Dependencies ---
_router_agent = None
_research_agent = None
_task_agent = None
_alert_agent = None
_main_agent = None

def get_services(db: Client = Depends(get_supabase_client)):
    global _router_agent, _research_agent, _task_agent, _alert_agent, _main_agent
    
    if not _router_agent:
        _router_agent = RouterAgent()
    if not _research_agent:
        _research_agent = ResearchAgentSimple()
    if not _task_agent:
        _task_agent = TaskAgent()
    if not _alert_agent:
        _alert_agent = alerts_agent_tool_async  # Function-based agent
    if not _main_agent:
        vector_store = VectorStoreService(db)
        _main_agent = ToviraAgent(vector_store)
        
    return {
        "router": _router_agent,
        "research": _research_agent,
        "task": _task_agent,
        "alert": _alert_agent,
        "main": _main_agent,
        "db": db
    }

# --- Endpoints ---

@router.post("/chat/router", response_model=RouterResponse)
async def check_intent_and_fee(
    message: ChatMessage,
    services: Dict = Depends(get_services)
):
    """
    Step 1: Determine Intent, Agent, and Fee.
    Frontend calls this first. If fee > 0, prompts user to sign tx.
    """
    try:
        # Validate query is not empty
        if not message.query or not message.query.strip():
            logger.warning(f"Empty query received from user {message.user_id}")
            return RouterResponse(
                intent=IntentType.CHAT,
                target_agent=AgentType.MAIN,
                requires_fee=False,
                estimated_cost=0.0,
                reason="Empty query received"
            )
        
        current_agent = AgentType(message.agent_id) if message.agent_id else AgentType.MAIN
        response = await services["router"].route_request(message.query, current_agent)
        logger.info(f"Router response: {response.model_dump()}")
        return response
    except Exception as e:
        logger.error(f"Router error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/chat/execute")
async def execute_agent(
    message: ChatMessage,
    background_tasks: BackgroundTasks,
    services: Dict = Depends(get_services)
):
    """
    Step 2: Execute the logic (after fee payment or if free).
    Streams text + steps.
    """
    user_id = message.user_id
    query = message.query
    chat_id = message.chat_id
    agent_type = AgentType(message.agent_id) if message.agent_id else AgentType.MAIN
    
    # 1. Ensure Chat ID
    db = services["db"]
    if not chat_id:
        # Create chat logic (simplified for brevity, usually same as before)
        chat_data = {"user_id": user_id, "name": query[:40]}
        res = db.table("chats").insert(chat_data).execute()
        chat_id = res.data[0]["chat_id"]

    # 2. Store User Query
    db.table("chat_messages").insert({
        "chat_id": chat_id, "user_id": user_id, "query": query, "sender": "user"
    }).execute()

    async def event_generator():
        # Yield Chat ID
        yield f"data: {json.dumps({'type': 'chat_id', 'chat_id': chat_id})}\n\n"
        
        # Select Agent
        if agent_type == AgentType.RESEARCH:
            # Special Handling for Research (Wait for stream events)
            agent = services["research"]
            inputs = {"messages": [("user", query)], "user_id": user_id}
            
            # Note: ResearchAgentSimple returns final messages, 
            # ideally we reimplement astream_events like main agent
            # For now, let's assume it supports astream_events or we just yield final.
            # To support "Steps", use astream_events on the graph.
            
            async for event in agent.graph.astream_events(inputs, version="v1"):
                kind = event["event"]
                name = event["name"]
                
                # Detect Tool Usage as "Steps"
                if kind == "on_tool_start":
                    yield f"data: {json.dumps({'type': 'step_start', 'step': f'Running {name}'})}\n\n"
                
                elif kind == "on_tool_end":
                    yield f"data: {json.dumps({'type': 'step_complete', 'step': f'Finished {name}'})}\n\n"
                    
                elif kind == "on_chat_model_stream":
                    content = event["data"]["chunk"].content
                    if content:
                        yield f"data: {json.dumps({'type': 'response', 'content': content})}\n\n"

        elif agent_type == AgentType.ALERT or agent_type == AgentType.TASK:
            # Alert/Task Agent - handles task/reminder/event creation
            # Both route to the same alerts_agent since they handle the same functionality
            alert_func = services["alert"]
            context = f"user_id:{user_id}\ntimezone:Africa/Lagos"
            
            try:
                response = await alert_func(query, context)
                yield f"data: {json.dumps({'type': 'response', 'content': response})}\n\n"
            except Exception as e:
                logger.error(f"Alert/Task agent error: {e}")
                yield f"data: {json.dumps({'type': 'error', 'content': f'Error creating task/alert: {str(e)}'})}\n\n"
        

        else: # Main Agent
            agent = services["main"]
            inputs = {"messages": [("user", query)], "user_id": user_id}
            async for event in agent.graph.astream_events(inputs, version="v1"):
                kind = event["event"]
                if kind == "on_chat_model_stream":
                    content = event["data"]["chunk"].content
                    if content:
                        yield f"data: {json.dumps({'type': 'response', 'content': content})}\n\n"

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/chats")
async def get_chats(user_id: str, db: Client = Depends(get_supabase_client)):
    """List all chats for a user"""
    res = db.table("chats").select("*").eq("user_id", user_id).order("last_updated", desc=True).execute()
    return {"chats": res.data}


@router.get("/chat/{chat_id}")
async def get_chat_history(chat_id: str, db: Client = Depends(get_supabase_client)):
    """Get message history for a chat"""
    # 1. Get Chat
    chat_res = db.table("chats").select("*").eq("chat_id", chat_id).execute()
    if not chat_res.data:
        raise HTTPException(status_code=404, detail="Chat not found")
        
    # 2. Get Messages
    msg_res = db.table("chat_messages").select("*").eq("chat_id", chat_id).order("timestamp", desc=False).execute()
    
    return {
        "chat": chat_res.data[0],
        "messages": msg_res.data
    }

@router.delete("/chat/{chat_id}")
async def delete_chat(chat_id: str, db: Client = Depends(get_supabase_client)):
    db.table("chats").delete().eq("chat_id", chat_id).execute()
    return {"status": "ok"}

