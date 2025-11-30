# app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routers import users, account, chats, waitlist, tasks, events
from app.core.config import settings
import uvicorn
import logging
from contextlib import asynccontextmanager
import os
import threading
from dotenv import load_dotenv

from app.telegram_bot.telegram_bot import create_telegram_application

load_dotenv()
logger = logging.getLogger(__name__)

bot_is_running = False


def start_bot_blocking(token: str):
    """
    Runs the PTB application in its own thread.
    Critical fix: disable OS signal handlers inside the thread.
    """
    global bot_is_running
    bot_is_running = True

    app = create_telegram_application(token)

    app.run_polling(
        allowed_updates=app.bot.allowed_updates,
        stop_signals=None,   # 🔥 FIX: disable OS signals
        close_loop=False     # 🔥 FIX: prevent loop closing inside the thread
    )

    bot_is_running = False


@asynccontextmanager
async def lifespan(app: FastAPI):
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

    yield

    logger.info("FastAPI is shutting down.")


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


@app.get("/")
async def root():
    return {"message": "Tovira API is running", "version": "1.0.0", "docs": "/docs"}


@app.get("/health")
async def health_check():
    return {"status": "healthy", "api_version": "1.0.0"}


@app.get("/telegram/status")
async def telegram_status():
    return {"status": "running" if bot_is_running else "stopped"}


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=port,
        reload=settings.ENVIRONMENT == "development",
        log_level="info"
    )
