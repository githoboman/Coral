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
from app.telegram_bot.telegram_bot import create_telegram_application

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global variable to store the Telegram bot application
telegram_app = None

# Worker ID to ensure only one worker starts the bot
WORKER_ID = os.getpid()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager to start and stop the Telegram bot
    alongside the FastAPI application
    """
    global telegram_app

    # Only start bot in the first worker (prevent multiple bot instances)
    is_main_worker = os.environ.get('WORKER_MAIN', 'false') == 'true'
    
    logger.info(f"🔧 Worker {WORKER_ID} starting (main={is_main_worker})")

    telegram_token = os.getenv('TELEGRAM_BOT_TOKEN')
    
    # Start bot only if we have a token and are the main worker
    if telegram_token and is_main_worker:
        try:
            logger.info("🚀 Starting Telegram bot...")
            
            # Create and setup the Telegram bot
            telegram_app = create_telegram_application(telegram_token)

            # Initialize the bot with timeout
            await asyncio.wait_for(telegram_app.initialize(), timeout=10.0)
            await asyncio.wait_for(telegram_app.start(), timeout=10.0)

            # Start polling in the background
            asyncio.create_task(telegram_app.updater.start_polling(
                allowed_updates=["message", "callback_query", "inline_query"],
                drop_pending_updates=True  # Don't process old messages
            ))

            logger.info("✅ Telegram bot started successfully")
            print("=" * 70)
            print("🔐 TOVIRA BOT - INTEGRATED SYSTEM")
            print("=" * 70)
            print("✅ FastAPI server running")
            print("✅ Telegram bot active")
            print("=" * 70)
        except asyncio.TimeoutError:
            logger.error("❌ Telegram bot initialization timed out")
            telegram_app = None
        except Exception as e:
            logger.error(f"❌ Failed to start Telegram bot: {e}", exc_info=True)
            telegram_app = None
            # Don't raise - continue without bot
    else:
        if not telegram_token:
            logger.warning("⚠️ TELEGRAM_BOT_TOKEN not found - running without Telegram bot")
        else:
            logger.info(f"⚠️ Worker {WORKER_ID} - bot will run in main worker only")

    logger.info(f"✅ Worker {WORKER_ID} ready to accept requests")
    
    yield  # Server is running

    # Shutdown: Stop the Telegram bot
    if telegram_app:
        logger.info("🛑 Stopping Telegram bot...")
        try:
            await telegram_app.updater.stop()
            await telegram_app.stop()
            await telegram_app.shutdown()
            logger.info("✅ Telegram bot stopped successfully")
        except Exception as e:
            logger.error(f"❌ Error stopping Telegram bot: {e}")


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
        "api_version": "1.0.0",
        "worker_id": WORKER_ID
    }


@app.get("/", summary="Root endpoint")
async def root():
    """Root endpoint to verify API is running"""
    return {
        "message": "Tovira API is running",
        "version": "1.0.0",
        "worker_id": WORKER_ID
    }


@app.get("/telegram/status", summary="Telegram bot status")
async def telegram_status():
    """
    Get detailed Telegram bot status
    """
    if not telegram_app:
        return {
            "status": "not_configured",
            "message": "Telegram bot token not configured or not running in this worker"
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