# app/schemas/chat.py
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


class ChatMessage(BaseModel):
    query: str = Field(..., min_length=1, max_length=5000,
                       description="User message")
    user_id: str = Field(..., description="User wallet address")
    chat_id: Optional[str] = Field(None, description="Chat session ID")
    agent_id: Optional[str] = Field(None, description="Target Agent ID")
    

class ChatUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100,
                      description="New chat name")


class ChatMessageResponse(BaseModel):
    response: str
    chat_id: str


class ChatResponseWithId(BaseModel):
    chat_id: str
    name: str
    created_at: datetime
    last_updated: datetime


class ChatListResponse(BaseModel):
    chats: List[ChatResponseWithId]


class ChatHistoryMessage(BaseModel):
    id: int
    chat_id: str
    query: str
    user_id: str
    sender: str
    timestamp: datetime


class ChatHistoryResponse(BaseModel):
    messages: List[ChatHistoryMessage]
    chat_id: str
