import asyncio
import logging
from typing import TypedDict, Optional
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate
from langgraph.graph import StateGraph, END
from app.core.config import settings
from app.services.agents import insights_agent, alerts_agent, general_agent, web3_agent

logger = logging.getLogger(__name__)

# === State Definition ===
class AgentState(TypedDict):
    query: str
    context: str
    task_type: Optional[str]
    response: Optional[str]


# === LLM for Intent Classification ===
llm = ChatGoogleGenerativeAI(
    model="gemini-2.5-flash",
    temperature=0.3,
    google_api_key=settings.GEMINI_API_KEY,
)

intent_prompt = ChatPromptTemplate.from_template("""
You are the COORDINATOR for a multi-agent system called Tovira.

Classify user intent into one of these categories:
- "insights" → for crypto, token, or market analysis
- "alerts" → for alert creation or tracking crypto prices
- "web3" → for blockchain/on-chain queries
- "multi" → if question needs multiple agent responses
- "general" → for small talk or off-topic questions

User message:
{query}

Return only one word: insights, alerts, web3, multi, or general.
""")


def classify_intent(state: AgentState):
    """Use the LLM to determine which agent should handle the query."""
    try:
        chain = intent_prompt | llm
        result = chain.invoke({"query": state["query"]})
        intent = result.content.strip().lower()
        logger.info(f"Classified intent: {intent}")
        return {"task_type": intent}
    except Exception as e:
        logger.error(f"Intent classification failed: {e}")
        return {"task_type": "general"}


# === Parallel Execution Helper ===
async def run_parallel_agents(state: AgentState):
    """
    Run insights, alerts, and Web3 agents concurrently, then merge responses.
    """
    query, context = state["query"], state["context"]

    async def _run_function_agent(agent_func, name: str):
        """Run a function-based agent (insights or alerts)."""
        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None, lambda: agent_func({"query": query, "context": context})
            )
            return (name, result.get("response", ""))
        except Exception as e:
            logger.error(f"{name} failed: {e}")
            return (name, f"{name.capitalize()} agent failed.")

    async def _run_web3_agent(name: str = "web3"):
        """Run the web3_agent (function-based)."""
        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, lambda: web3_agent(state))
            return (name, result.get("response", ""))
        except Exception as e:
            logger.error(f"{name} failed: {e}")
            return (name, f"{name.capitalize()} agent failed.")

    # Launch all agents concurrently
    tasks = [
        _run_function_agent(insights_agent, "insights"),
        _run_function_agent(alerts_agent, "alerts"),
        _run_web3_agent("web3"),
    ]

    results = await asyncio.gather(*tasks)

    # Merge all results into a unified response
    merged = "\n\n".join(
        [f"🧩 **{name.capitalize()} Agent:**\n{resp}" for name, resp in results]
    )
    return {"response": merged}


# === Coordinator Agent (Main Router) ===
async def coordinator_async(state: AgentState):
    """
    Routes query to the appropriate agent based on classified task_type.
    Handles multi-agent execution and merging.
    """
    task = state.get("task_type", "general")
    logger.info(f"Coordinator routing task: {task}")

    if task == "multi":
        return await run_parallel_agents(state)
    elif task == "insights":
        return insights_agent(state)
    elif task == "alerts":
        return alerts_agent(state)
    elif task == "web3":
        return web3_agent(state)
    else:
        return general_agent(state)


# === LangGraph Setup ===
graph = StateGraph(AgentState)
graph.add_node("classify_intent", classify_intent)
graph.set_entry_point("classify_intent")
graph.add_edge("classify_intent", END)
compiled_graph = graph.compile()


# === Public Entry Point (for chat route) ===
async def generate_ai_response(query: str, context: list = None) -> str:
    """
    Main function to process chat messages.
    1. Classify query intent.
    2. Route or parallelize agents.
    3. Optionally summarize combined outputs.
    """
    context_text = "\n".join(
        [f"{m['role'].capitalize()}: {m['content']}" for m in (context or [])]
    )

    # Step 1: Intent Classification
    state = {"query": query, "context": context_text, "response": None, "task_type": None}
    classified = compiled_graph.invoke(state)
    state["task_type"] = classified.get("task_type", "general")

    # Step 2: Route to correct agent(s)
    result = await coordinator_async(state)

    # Step 3: Optional Summarization for Multi-Agent Outputs
    if state["task_type"] == "multi":
        try:
            summarizer_prompt = ChatPromptTemplate.from_template("""
            You are Tovira, the AI-powered Web3 sidekick.
            Summarize the following combined agent outputs
            into a concise and insightful paragraph:

            {merged}

            Respond as Tovira:
            """)
            chain = summarizer_prompt | llm
            summary = chain.invoke({"merged": result["response"]})
            return summary.content
        except Exception as e:
            logger.error(f"Summary generation failed: {e}")

    return result["response"]
