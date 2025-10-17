# app/core/config.py
from pydantic_settings import BaseSettings
from dotenv import load_dotenv
import logging

logger = logging.getLogger(__name__)

load_dotenv()

class Settings(BaseSettings):
    SUPABASE_URL: str
    SUPABASE_KEY: str
    TELEGRAM_BOT_TOKEN: str = ""  # Optional for now
    SUI_NETWORK_RPC: str = "https://fullnode.devnet.sui.io:443"
    ENVIRONMENT: str = "development"

    # --- Optional values ---
    BOT_USERNAME: str | None = None
    GEMINI_API_KEY: str | None = None
    AGENT: str | None = None
    EMAIL_USER: str | None = None
    EMAIL_PASSWORD: str | None = None

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

settings = Settings()

# Validate Supabase configuration
if not settings.SUPABASE_URL or not settings.SUPABASE_KEY:
    logger.error("Missing SUPABASE_URL or SUPABASE_KEY in .env file")
    raise ValueError("SUPABASE_URL and SUPABASE_KEY must be set in the .env file")

# Validate Gemini API key
if not settings.GEMINI_API_KEY:
    logger.warning("⚠️ GEMINI_API_KEY not found in .env — AI features may not work.")
