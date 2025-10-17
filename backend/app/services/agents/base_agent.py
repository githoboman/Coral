# app/services/agents/base_agent.py
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate
from langgraph.graph import StateGraph, END
from typing import TypedDict
import logging
from app.core.config import settings

logger = logging.getLogger(__name__)

# --- Define State Schema ---
class AgentState(TypedDict):
    query: str
    context: str
    response: str | None

# --- Build Base Model ---
try:
    llm = ChatGoogleGenerativeAI(
        model="gemini-2.5-flash",
        temperature=0.7,
        google_api_key=settings.GEMINI_API_KEY,
    )
except Exception as e:
    logger.error(f"Failed to initialize Gemini model: {e}")
    raise

# --- Prompt Template ---
prompt = ChatPromptTemplate.from_template("""
You are Tovira, a friendly AI assistant.
You respond helpfully, clearly, and concisely.

Conversation history:
{context}

User: {query}
AI:
""")

# --- LangGraph Node ---
def simple_agent(state: AgentState):
    query = state["query"]
    context = state.get("context", "")
    try:
        chain = prompt | llm
        result = chain.invoke({"query": query, "context": context})
        return {"response": result.content}
    except Exception as e:
        logger.error(f"LangGraph agent error: {e}")
        return {"response": "Sorry, something went wrong while generating a response."}

# --- Build Graph ---
graph = StateGraph(AgentState)
graph.add_node("agent", simple_agent)
graph.set_entry_point("agent")
graph.add_edge("agent", END)
compiled_graph = graph.compile()

# --- Public API ---
async def generate_ai_response(query: str, context: list = None) -> str:
    """
    Invoked from FastAPI router. Wraps LangGraph agent execution.
    """
    context_text = "\n".join(
        [f"{m['role'].capitalize()}: {m['content']}" for m in (context or [])]
    )
    result = compiled_graph.invoke({"query": query, "context": context_text})
    return result["response"]
