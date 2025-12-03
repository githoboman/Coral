from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routers import users, account, chats, waitlist, tasks, events
from app.core.config import settings
import uvicorn
import asyncio
import logging
from contextlib import asynccontextmanager
import os
import threading
from dotenv import load_dotenv

from app.telegram_bot.telegram_bot import create_telegram_application

load_dotenv()
logger = logging.getLogger(__name__)

bot_is_running = False

app = FastAPI(
    title="Tovira API",
    description="API for waitlist, chat, user profiles, tasks, events and Telegram bot integration.",
    version="1.0.0",
    lifespan=lifespan
)

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

app.include_router(users.router, prefix="/api", tags=["users"])
app.include_router(account.router, prefix="/api", tags=["account"])
app.include_router(chats.router, prefix="/api", tags=["chats"])
app.include_router(tasks.router, prefix="/api", tags=["tasks"])
app.include_router(events.router, prefix="/api", tags=["events"])
app.include_router(waitlist.router, tags=["waitlist"])


@app.get("/", summary="Root endpoint")
async def root():
    return {
        "message": "Tovira API is running",
        "version": "1.0.0",
        "docs": "/docs"
    }


@app.get("/health", summary="Health check")
async def health_check():
    return {"status": "healthy", "api_version": "1.0.0"}


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=port,
        reload=settings.ENVIRONMENT == "development",
        log_level="info"
    )
