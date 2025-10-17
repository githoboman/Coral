from pydantic import BaseModel
from typing import List, Optional

class ChatMessage(BaseModel):
    query: str
    user_id: str | None
    chat_id: str | None = None

class ChatUpdate(BaseModel):
    name: str

class ChatResponse(BaseModel):
    chat_id: str
    name: str
    created_at: str
    last_updated: str

class ChatListResponse(BaseModel):
    chats: List[ChatResponse]

class MessageResponse(BaseModel):
    id: int
    chat_id: str
    query: str
    user_id: str | None
    sender: str
    timestamp: str

class ChatMessageResponse(BaseModel):
    messages: List[MessageResponse]

class ChatResponseWithId(BaseModel):
    chat_id: str
    response: str