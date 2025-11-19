# app/services/agents/llm_factory.py
"""
Centralized LLM Factory to avoid circular imports
"""
import asyncio
from typing import Optional
from langchain_google_genai import ChatGoogleGenerativeAI
from app.core.config import settings


class LLMFactory:
    """Singleton factory for creating and reusing LLM instances"""
    _instance: Optional[ChatGoogleGenerativeAI] = None
    _lock = asyncio.Lock()

    @classmethod
    async def get_llm(cls, temperature: float = 0.3) -> ChatGoogleGenerativeAI:
        """Get or create LLM instance with specified temperature"""
        if cls._instance is None:
            async with cls._lock:
                if cls._instance is None:
                    cls._instance = ChatGoogleGenerativeAI(
                        model="gemini-2.5-flash",
                        temperature=temperature,
                        google_api_key=settings.GEMINI_API_KEY,
                        max_retries=3,
                        request_timeout=30.0,
                    )
        return cls._instance
