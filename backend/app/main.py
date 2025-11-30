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
import threading
from dotenv import load_dotenv

# Import Telegram bot components
from app.telegram_bot.telegram_bot import create_telegram_application

load_dotenv()
logger = logging.getLogger(__name__)

# Global tracker (not the bot instance itself)
bot_is_running = False


def start_bot_blocking(token: str):
    """
    Runs the PTB application using run_polling() inside its own thread.
    This function NEVER returns until the app stops.
    """
    global bot_is_running
    bot_is_running = True

    app = create_telegram_application(token)

    bot_is_running = False  # Only executes if bot fully stops


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    FastAPI lifespan startup/shutdown manager.
    Starts the Telegram bot in a separate thread.
    """
    global bot_is_running

    telegram_token = os.getenv("TELEGRAM_BOT_TOKEN")

    if telegram_token:
        logger.info("Starting Telegram bot thread...")

        bot_thread = threading.Thread(
            target=start_bot_blocking,
            args=(telegram_token,),
            daemon=True
        )
        bot_thread.start()

        logger.info("Telegram bot started in background thread")
        print("=" * 70)
        print("Application started with Telegram bot")
        print("=" * 70)

    else:
        print("TELEGRAM_BOT_TOKEN not set — bot disabled")

    yield  # API is running

    logger.info("FastAPI is shutting down.")
    # Threaded bot stops only when process stops


app = FastAPI(
    title="Tovira API",
    description="API for waitlist, chat, user profiles, tasks, events and Telegram bot integration.",
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


@app.get("/telegram/status", summary="Telegram bot status")
async def telegram_status():
    """
    Because the bot runs in its own thread with run_polling(),
    we cannot query its internal state, but we can expose simple info.
    """
    return {
        "status": "running" if bot_is_running else "stopped"
    }


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=port,
        reload=settings.ENVIRONMENT == "development",
        log_level="info"
    )
