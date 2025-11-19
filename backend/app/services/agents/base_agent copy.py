# app/services/agents/base_agent.py
import asyncio
import json
import logging
from typing import Optional, List, Dict, Any, AsyncGenerator
from datetime import datetime
import hashlib
from enum import Enum

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from pydantic import BaseModel, Field

from langgraph.graph import StateGraph, END
from typing import TypedDict

from app.core.config import settings
from app.services.agents.alerts_agent import alerts_agent_tool_async as alerts_agent_tool_impl
from app.services.agents.general_agent import general_agent_async
from app.services.agents.insights_agent import insights_agent_tool_async as insights_agent_tool_impl
from app.services.agents.web3_agent import web3_agent_tool_async as web3_agent_tool_impl

logger = logging.getLogger(__name__)


# === ENUMS AND MODELS ===
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
    context: List[Dict[str, str]] = Field(default_factory=list)
    user_id: Optional[str] = None
    timestamp: Optional[str] = None


class AgentResponse(BaseModel):
    response: str
    agent_used: Optional[AgentType] = None
    cached: bool = False
    processing_time_ms: Optional[float] = None

# === CIRCUIT BREAKER ===
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
            raise Exception(f"Circuit breaker OPEN for {tool_name} - cooling down")

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
            elapsed = (datetime.utcnow() - self.last_failure_time.get(tool_name, datetime.min)).total_seconds()
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
            self.success_count[tool_name] = self.success_count.get(tool_name, 0) + 1
            if self.success_count[tool_name] >= 2:
                self._reset(tool_name)
        else:
            self.failures[tool_name] = 0

    def _reset(self, tool_name: str):
        self.failures[tool_name] = 0
        self.success_count[tool_name] = 0
        self.circuit_state[tool_name] = CircuitState.CLOSED


circuit_breaker = AsyncCircuitBreaker()


# === CACHE ===
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


response_cache = ResponseCache(ttl=300, max_size=1000)


# === LLM FACTORY ===
class LLMFactory:
    _instance: Optional[ChatGoogleGenerativeAI] = None
    _lock = asyncio.Lock()

    @classmethod
    async def get_llm(cls, temperature: float = 0.3) -> ChatGoogleGenerativeAI:
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


# === TOOL REGISTRY ===
class ToolRegistry:
    def __init__(self):
        self.tools = {
            AgentType.INSIGHTS: insights_agent_tool_impl,
            AgentType.WEB3: web3_agent_tool_impl,
            AgentType.ALERTS: alerts_agent_tool_impl,
        }

    async def execute_tool(self, agent_type: AgentType, query: str, context: str) -> str:
        if agent_type not in self.tools:
            raise ValueError(f"Unknown tool: {agent_type}")
        func = self.tools[agent_type]
        return await circuit_breaker.call_async(agent_type.value, func, query, context)


tool_registry = ToolRegistry()

# === RESPONSE POLISHING ===
async def _polish_response_stream(query: str, tool_output: str) -> AsyncGenerator[str, None]:
    if len(tool_output) < 100:
        for char in tool_output:
            yield char
            await asyncio.sleep(0.01)
        return
    try:
        llm = await LLMFactory.get_llm(temperature=0.2)
        prompt = ChatPromptTemplate.from_messages([
            ("system", "You are Tovira. Reformat the tool output into a clear, friendly response while keeping key info."),
            ("human", "User asked: {query}\n\nTool output: {output}\n\nYour response:")
        ])
        chain = prompt | llm
        async for chunk in chain.astream({"query": query, "output": tool_output}):
            yield chunk.content if hasattr(chunk, 'content') else str(chunk)
    except Exception as e:
        logger.warning(f"Polishing failed: {e}")
        for char in tool_output:
            yield char
            await asyncio.sleep(0.01)


# === MAIN STREAMING ENTRYPOINT ===
async def generate_ai_response_stream(
    query: str,
    context: List[Dict] = None,
    user_id: str = None
) -> AsyncGenerator[Dict[str, Any], None]:
    if not query or not query.strip():
        yield {"type": "response", "content": "I didn't receive a message. How can I help you?"}
        return

    try:
        context_str = "\n".join([f"{m.get('role')}: {m.get('content')}" for m in (context or [])[-5:]])
        cache_key = ResponseCache.generate_key(query, context_str)
        cached = response_cache.get(cache_key)

        if cached:
            yield {"type": "agent_info", "agent": cached["agent"], "cached": True}
            for char in cached["response"]:
                yield {"type": "response", "content": char}
                await asyncio.sleep(0.01)
            return

        # === INTENT CLASSIFICATION (Updated with improved prompt) ===
        try:
            llm = await LLMFactory.get_llm(temperature=0.2)
            # IMPROVED PROMPT: Added few-shot examples and explicit rules for semantic routing
            prompt = ChatPromptTemplate.from_messages([
                ("system", """Classify the user query into EXACTLY ONE category: insights, web3, alerts, or general.
Rules:
- 'web3': Crypto, tokens, blockchain, Sui/DeFi/NFT queries, market analysis/sentiment for coins (e.g., "Research SUI token", "Analyze BTC sentiment", "What's the price of ETH?").
- 'insights': Non-crypto data research, analytics, trends, reports (e.g., "Research stock market trends", "Analyze sales data").
- 'alerts': Notifications, price watches, alerts setup (e.g., "Alert me if ETH drops below $2000").
- 'general': Everything else—casual chat, jokes, weather, non-specialized questions.

Examples:
Query: "Research a token on Sui" → web3
Query: "Analyze BTC market sentiment" → web3
Query: "Set up alerts for ETH price" → alerts
Query: "Tell me a joke" → general
Query: "Research climate change" → insights

Respond with ONLY the category name, lowercase. No explanations."""),
                ("human", "{query}")
            ])
            chain = prompt | llm | StrOutputParser()
            intent = (await chain.ainvoke({"query": query})).strip().lower()
            # Validation: Fallback if invalid
            if intent not in {t.value for t in AgentType}:
                intent = "general"
                logger.warning(f"Invalid intent '{intent}' for query '{query}'—falling back to general")
        except Exception as e:
            logger.warning(f"Intent failed: {e}")
            intent = "general"

        agent_type = AgentType(intent)
        yield {"type": "agent_info", "agent": agent_type.value, "cached": False}

        # === TOOL EXECUTION ===
        response_text = ""
        if agent_type != AgentType.GENERAL:
            try:
                response_text = await tool_registry.execute_tool(agent_type, query, context_str)
            except Exception as e:
                agent_type = AgentType.GENERAL
        else:
            result = await general_agent_async({"query": query, "context": context_str})
            response_text = result.get("response", str(result))

        # === FINAL POLISHING ===
        final_response = ""
        if agent_type != AgentType.INSIGHTS and response_text:
            async for token in _polish_response_stream(query, response_text):
                final_response += token
                yield {"type": "response", "content": token}
        else:
            for char in response_text:
                final_response += char
                yield {"type": "response", "content": char}
                await asyncio.sleep(0.01)

        # === CACHE RESULT ===
        response_cache.set(cache_key, {
            "response": final_response,
            "agent": agent_type.value,
        })

        yield {"type": "done"}

    except Exception as e:
        logger.exception(f"Error in stream: {e}")
        yield {"type": "response", "content": "I encountered an error. Please try again."}


# === LANGGRAPH (Updated classify_intent_llm_node) ===
class AgentGraphState(TypedDict, total=False):
    query: str
    context: List[Dict[str, str]]
    user_id: Optional[str]
    agent_type: Optional[AgentType]
    response: Optional[str]
    cache_key: Optional[str]
    cached: bool
    error: Optional[str]


async def cache_check_node(state: dict) -> dict:
    try:
        context = state.get("context", [])
        query = state.get("query", "")
        context_str = "\n".join([f"{msg.get('role')}: {msg.get('content')}" for msg in context[-5:]])
        cache_key = ResponseCache.generate_key(query, context_str)
        cached = response_cache.get(cache_key)
        if cached:
            return {**state, "response": cached["response"], "cached": True, "cache_key": cache_key}
        return {**state, "cached": False, "cache_key": cache_key}
    except Exception as e:
        logger.error(f"Cache check failed: {e}")
        return {**state, "cached": False}


async def classify_intent_llm_node(state: dict) -> dict:
    try:
        query = state.get("query", "")
        llm = await LLMFactory.get_llm(temperature=0.2)
        # IMPROVED PROMPT: Same as above—few-shot for semantic accuracy
        prompt = ChatPromptTemplate.from_messages([
            ("system", """Classify the user query into EXACTLY ONE category: insights, web3, alerts, or general.
Rules:
- 'web3': Crypto, tokens, blockchain, Sui/DeFi/NFT queries, market analysis/sentiment for coins (e.g., "Research SUI token", "Analyze BTC sentiment", "What's the price of ETH?").
- 'insights': Non-crypto data research, analytics, trends, reports (e.g., "Research stock market trends", "Analyze sales data").
- 'alerts': Notifications, price watches, alerts setup (e.g., "Alert me if ETH drops below $2000").
- 'general': Everything else—casual chat, jokes, weather, non-specialized questions.

Examples:
Query: "Research a token on Sui" → web3
Query: "Analyze BTC market sentiment" → web3
Query: "Set up alerts for ETH price" → alerts
Query: "Tell me a joke" → general
Query: "Research climate change" → insights

Respond with ONLY the category name, lowercase. No explanations."""),
            ("human", "User query: {query}")
        ])
        chain = prompt | llm | StrOutputParser()
        result = await asyncio.wait_for(chain.ainvoke({"query": query}), timeout=8.0)
        intent = result.strip().lower()
        # Validation: Fallback if invalid
        if intent not in ["insights", "web3", "alerts", "general"]:
            intent = "general"
            logger.warning(f"Invalid intent '{intent}' for query '{query}'—falling back to general")
        return {**state, "agent_type": AgentType(intent)}
    except Exception as e:
        logger.exception("Intent classification failed")
        return {**state, "agent_type": AgentType.GENERAL}


async def route_to_agent_node(state: dict) -> dict:
    try:
        if state.get("cached") and state.get("response"):
            return state
        context = state.get("context", [])
        query = state.get("query", "")
        agent_type = state.get("agent_type", AgentType.GENERAL)
        cache_key = state.get("cache_key")
        context_str = "\n".join([f"{msg.get('role')}: {msg.get('content')}" for msg in context[-5:]])
        if agent_type != AgentType.GENERAL:
            response_text = await tool_registry.execute_tool(agent_type, query, context_str)
            if agent_type != AgentType.INSIGHTS:
                polished = ""
                async for token in _polish_response_stream(query, response_text):
                    polished += token
                response_text = polished
        else:
            result = await general_agent_async({"query": query, "context": context_str})
            response_text = result.get("response", str(result))
        if cache_key:
            response_cache.set(cache_key, {"response": response_text, "agent": agent_type.value})
        return {**state, "response": response_text, "cached": False}
    except Exception as e:
        logger.exception(f"Agent routing failed: {e}")
        return {**state, "error": str(e)}


async def fallback_node(state: dict) -> dict:
    try:
        if state.get("response"):
            return state
        context = state.get("context", [])
        query = state.get("query", "")
        context_str = "\n".join([f"{m.get('role')}: {m.get('content')}" for m in context[-5:]])
        result = await general_agent_async({"query": query, "context": context_str})
        return {**state, "response": result.get("response", "Fallback response"), "agent_type": AgentType.GENERAL}
    except Exception as e:
        logger.exception("Fallback failed")
        return {**state, "response": "I encountered an error. Please try again later."}


graph = StateGraph(AgentGraphState)
graph.add_node("cache_check", cache_check_node)
graph.add_node("classify_intent", classify_intent_llm_node)
graph.add_node("route_to_agent", route_to_agent_node)
graph.add_node("fallback", fallback_node)
graph.set_entry_point("cache_check")
graph.add_edge("cache_check", "classify_intent")
graph.add_edge("classify_intent", "route_to_agent")
graph.add_conditional_edges(
    "route_to_agent",
    lambda s: "fallback" if s.get("error") else END,
    {"fallback": "fallback", END: END}
)
graph.add_edge("fallback", END)
compiled_agent_graph = graph.compile()


async def generate_ai_response(
    query: str,
    context: List[Dict] = None,
    user_id: str = None
) -> str:
    if not query or not query.strip():
        return "I didn't receive a message. How can I help you?"
    try:
        start_time = datetime.utcnow()
        state = await compiled_agent_graph.ainvoke({
            "query": query,
            "context": context or [],
            "user_id": user_id
        })
        elapsed = (datetime.utcnow() - start_time).total_seconds() * 1000
        logger.info(f"Response generated (agent={state.get('agent_type')}, cached={state.get('cached')}, time={round(elapsed,2)}ms)")
        return state.get("response", "No response generated.")
    except asyncio.TimeoutError:
        return "Request timeout. Please try again."
    except Exception as e:
        logger.exception(f"Error: {e}")
        return "I encountered an error. Please try again later."


async def generate_chat_name(message: str) -> str:
    try:
        llm = await LLMFactory.get_llm(temperature=0.5)
        prompt = ChatPromptTemplate.from_messages([
            ("system", "You generate short, relevant chat names. Keep it under 5 words."),
            ("human", "Message: {message}")
        ])
        chain = prompt | llm | StrOutputParser()
        name = await asyncio.wait_for(chain.ainvoke({"message": message}), timeout=10.0)
        return name.strip().title()
    except Exception:
        return "New Chat"
    
    