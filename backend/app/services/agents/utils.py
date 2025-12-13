# app/services/agents/utils.py
import asyncio
import logging
from typing import Optional, Dict, Any
from enum import Enum
from datetime import datetime
import hashlib

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from pydantic import BaseModel, Field

from app.core.config import settings

logger = logging.getLogger(__name__)


class AgentType(str, Enum):
    INSIGHTS = "insights"
    WEB3 = "web3"
    ALERTS = "alerts"
    GENERAL = "general"


class CircuitState(str, Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class AgentInput(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000)
    context: Dict[str, str] = Field(
        default_factory=dict)  # Simplified for utils
    user_id: Optional[str] = None
    timestamp: Optional[str] = None


class AgentResponse(BaseModel):
    response: str
    agent_used: Optional[AgentType] = None
    cached: bool = False
    processing_time_ms: Optional[float] = None


class AsyncCircuitBreaker:
    def __init__(self, failure_threshold: int = 3, timeout: int = 120, half_open_timeout: int = 30):
        self.failure_threshold = failure_threshold
        self.timeout = timeout
        self.half_open_timeout = half_open_timeout
        self.failures: Dict[str, int] = {}
        self.last_failure_time: Dict[str, datetime] = {}
        self.circuit_state: Dict[str, CircuitState] = {}
        self.success_count: Dict[str, int] = {}

    async def call_async(self, tool_name: str, func, *args, **kwargs):
        state = self._get_circuit_state(tool_name)
        if state == CircuitState.OPEN:
            raise Exception(
                f"Circuit breaker OPEN for {tool_name} - cooling down")

        try:
            result = await func(*args, **kwargs)
            self._on_success(tool_name)
            return result
        except Exception as e:
            self._on_failure(tool_name)
            logger.error(f"Task failed for tool '{tool_name}': {e}")
            raise

    def _get_circuit_state(self, tool_name: str) -> CircuitState:
        current_state = self.circuit_state.get(tool_name, CircuitState.CLOSED)
        if current_state == CircuitState.OPEN:
            elapsed = (datetime.utcnow(
            ) - self.last_failure_time.get(tool_name, datetime.min)).total_seconds()
            if elapsed > self.timeout:
                self.circuit_state[tool_name] = CircuitState.HALF_OPEN
        return self.circuit_state.get(tool_name, CircuitState.CLOSED)

    def _on_failure(self, tool_name: str):
        self.failures[tool_name] = self.failures.get(tool_name, 0) + 1
        self.last_failure_time[tool_name] = datetime.utcnow()
        if self.failures[tool_name] >= self.failure_threshold:
            self.circuit_state[tool_name] = CircuitState.OPEN

    def _on_success(self, tool_name: str):
        state = self.circuit_state.get(tool_name, CircuitState.CLOSED)
        if state == CircuitState.HALF_OPEN:
            self.success_count[tool_name] = self.success_count.get(
                tool_name, 0) + 1
            if self.success_count[tool_name] >= 2:
                self._reset(tool_name)
        else:
            self.failures[tool_name] = 0

    def _reset(self, tool_name: str):
        self.failures[tool_name] = 0
        self.success_count[tool_name] = 0
        self.circuit_state[tool_name] = CircuitState.CLOSED


class ResponseCache:
    def __init__(self, ttl: int = 300, max_size: int = 1000):
        self.cache: Dict[str, tuple] = {}
        self.ttl = ttl
        self.max_size = max_size

    def get(self, key: str) -> Optional[Dict]:
        if key in self.cache:
            value, timestamp = self.cache[key]
            if (datetime.utcnow() - timestamp).total_seconds() < self.ttl:
                return value
            else:
                del self.cache[key]
        return None

    def set(self, key: str, value: Dict):
        if len(self.cache) >= self.max_size:
            self._evict_oldest()
        self.cache[key] = (value, datetime.utcnow())

    def _evict_oldest(self):
        sorted_items = sorted(self.cache.items(), key=lambda x: x[1][1])
        for key, _ in sorted_items[: max(1, len(self.cache) // 10)]:
            del self.cache[key]

    @staticmethod
    def generate_key(query: str, context: str) -> str:
        return hashlib.md5(f"{query}:{context}".encode()).hexdigest()


class ToolRegistry:
    def __init__(self):
        # Tools injected here; in base_agent, populate after imports
        self.tools: Dict[AgentType, Any] = {}

    def register_tool(self, agent_type: AgentType, tool_func):
        self.tools[agent_type] = tool_func

    async def execute_tool(self, agent_type: AgentType, query: str, context: str = "", extra_data: Optional[Dict] = None) -> str:
        if agent_type not in self.tools:
            raise ValueError(f"Unknown tool: {agent_type}")
        func = self.tools[agent_type]
        return await circuit_breaker.call_async(agent_type.value, func, query, context, extra_data or {})


# Global instances (shared)
circuit_breaker = AsyncCircuitBreaker()
response_cache = ResponseCache(ttl=300, max_size=1000)
tool_registry = ToolRegistry()


class LLMFactory:
    _instance: Optional[ChatGoogleGenerativeAI] = None
    _lock = asyncio.Lock()

    @classmethod
    async def get_llm(cls, temperature: float = 0.3) -> ChatGoogleGenerativeAI:
        if cls._instance is None:
            async with cls._lock:
                if cls._instance is None:
                    cls._instance = ChatGoogleGenerativeAI(
                        model=settings.LLM_MODEL,
                        temperature=temperature,
                        google_api_key=settings.GEMINI_API_KEY,
                        max_retries=3,
                        request_timeout=30.0,
                    )
        return cls._instance


async def extract_crypto_entity(query: str) -> Optional[str]:
    """
    Uses LLM to intelligently detect if the query is about a specific crypto token or NFT project.
    Returns the symbol (e.g., 'SUI', 'ETH') or None.
    """
    llm = await LLMFactory.get_llm(temperature=0.0)  # deterministic
    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are a crypto expert. Analyze the user query.

Answer with ONLY:
- The token symbol (e.g., SUI, ETH, BTC) in uppercase, OR
- "null" if it's NOT about a specific token/NFT project.

Rules:
- "SUI price" → SUI
- "What is trending in NFTs?" → null
- "How is DOGE doing?" → DOGE
- "Tell me about CAT" → null
- "Analyze BTC sentiment" → BTC
- "Research climate change" → null
- "0x123... object" → null (object ID, not token)
- "Buy $WHAT" → WHAT

Return ONLY the symbol or "null". No explanation."""),
        ("human", "{query}")
    ])
    chain = prompt | llm | StrOutputParser()
    result = (await chain.ainvoke({"query": query})).strip().upper()
    return result if result != "NULL" else None
