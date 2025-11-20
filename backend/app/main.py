# app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routers import users, account, chats, waitlist, tasks, events
from app.core.config import settings
import uvicorn
import asyncio
import logging
from contextlib import asynccontextmanager
import os
from dotenv import load_dotenv

# Import Telegram bot components
from telegram.ext import Application
# from app.telegram_bot.telegram_bot import create_telegram_application

load_dotenv()
logger = logging.getLogger(__name__)

# Global variable to store the Telegram bot application
telegram_app = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("✅ FastAPI starting without Telegram bot")
    yield
    logger.info("👋 FastAPI shutting down")

app = FastAPI(
    title="Tovira API",
    description="API for handling waitlist email submissions, chat messages, user profile management, task scheduling, event management, and Telegram bot integration",
    version="1.0.0",
    lifespan=lifespan
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

# Include routers
app.include_router(users.router, prefix="/api", tags=["users"])
app.include_router(account.router, prefix="/api", tags=["account"])
app.include_router(chats.router, prefix="/api", tags=["chats"])
app.include_router(tasks.router, prefix="/api", tags=["tasks"])
app.include_router(events.router, prefix="/api", tags=["events"])
app.include_router(waitlist.router, tags=["waitlist"])


@app.get("/health", summary="Health check")
async def health_check():
    """
    Health check endpoint that includes Telegram bot status
    """
    telegram_status = "active" if telegram_app and telegram_app.running else "inactive"
    return {
        "status": "healthy",
        "telegram_bot": telegram_status,
        "api_version": "1.0.0"
    }


@app.get("/telegram/status", summary="Telegram bot status")
async def telegram_status():
    """
    Get detailed Telegram bot status
    """
    if not telegram_app:
        return {
            "status": "not_configured",
            "message": "Telegram bot token not configured"
        }

    return {
        "status": "running" if telegram_app.running else "stopped",
        "bot_username": telegram_app.bot.username if telegram_app.bot else None,
        "update_queue_size": telegram_app.update_queue.qsize() if telegram_app.update_queue else 0
    }


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.ENVIRONMENT == "development",
        log_level="info"
    )
