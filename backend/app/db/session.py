# app/db/session.py
from supabase import create_client, Client, ClientOptions
from app.core.config import settings
import logging

logger = logging.getLogger(__name__)

_supabase_client = None

def get_supabase_client() -> Client:
    global _supabase_client
    if _supabase_client is None:
        try:
            options = ClientOptions(
                headers={
                    "Authorization": f"Bearer {settings.SUPABASE_KEY}",
                    "apiKey": settings.SUPABASE_KEY
                }
            )

            _supabase_client = create_client(
                settings.SUPABASE_URL,
                settings.SUPABASE_KEY,
                options=options
            )

            logger.info("Supabase client initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize Supabase client: {str(e)}")
            raise ValueError(f"Failed to initialize Supabase client: {str(e)}")
    return _supabase_client
