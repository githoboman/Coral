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


@asynccontextmanager
async def lifespan(app: FastAPI):
    telegram_token = os.getenv("TELEGRAM_BOT_TOKEN")
    bot_task = None

    if telegram_token:
        print("Starting Telegram bot in background...")

        # Create the application
        bot_app = create_telegram_application(telegram_token)

        # Initialize (connects to Telegram servers)
        await bot_app.initialize()

        # Start the updater (starts polling updates in background)
        await bot_app.updater.start_polling()

        # Start processing updates
        await bot_app.start()

        print("Telegram bot is running!")

        # Keep reference so we can stop it later
        app.state.telegram_bot = bot_app

    # FastAPI runs here
    yield

    # Shutdown
    if telegram_token and hasattr(app.state, "telegram_bot"):
        print("Stopping Telegram bot...")
        await app.state.telegram_bot.stop()
        await app.state.telegram_bot.updater.stop()
        await app.state.telegram_bot.shutdown()
        print("Telegram bot stopped.")

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
