import logging
import operator
from typing import Annotated, Sequence, TypedDict, List, Union

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage, ToolMessage
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode

from app.core.config import settings
from app.services.vector_store import VectorStoreService
from app.services.agents.tools import get_agent_tools

# Initialize Logger
logger = logging.getLogger(__name__)

# --- State Definition ---
class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], operator.add]
    user_id: str
    context: str # Retrieved from vector store

# --- Nodes ---

async def retrieve_node(state: AgentState, vector_store: VectorStoreService):
    """
    Retrieve relevant observations from vector store based on the last message.
    """
    try:
        last_message = state["messages"][-1]
        if isinstance(last_message, HumanMessage):
            query = last_message.content
            context = await vector_store.recall_memories(query, state["user_id"])
            return {"context": context}
        return {"context": ""}
    except Exception as e:
        logger.error(f"Error in retrieve_node: {e}")
        # Return empty context if vector store fails - don't crash the chat
        return {"context": ""}

def agent_node(state: AgentState, llm: ChatGoogleGenerativeAI):
    """
    The core agent node that decides what to do.
    """
    messages = state["messages"]
    context = state.get("context", "")
    
    system_message = f"""You are Tovira, an advanced Web3 AI Agent built on the Sui blockchain.
    
    **Your Capabilities:**
    - You can search the web for real-time crypto data, news, and project details.
    - You rely on 'context' provided from past conversations to maintain continuity.
    - You are helpful, accurate, and concise.

    **Context from Memory:**
    {context}
    
    If the user asks about something requiring up-to-date info (price, news, recent events), USE THE SEARCH TOOL.
    Do not guess.
    """
    
    # Prepend system message
    full_history = [SystemMessage(content=system_message)] + list(messages)
    
    response = llm.invoke(full_history)
    return {"messages": [response]}

# --- Graph Construction ---

class ToviraAgent:
    def __init__(self, vector_store: VectorStoreService):
        self.vector_store = vector_store
        
        # Tools
        self.tools = get_agent_tools()
        self.tool_node = ToolNode(self.tools)
        
        # LLM with Tools
        self.llm = ChatGoogleGenerativeAI(
            model=settings.LLM_MODEL, # Or gemini-1.5-pro-latest
            google_api_key=settings.GEMINI_API_KEY,
            temperature=0.3
        ).bind_tools(self.tools)
        
        self.graph = self._build_graph()

    def _build_graph(self):
        workflow = StateGraph(AgentState)
        
        # Create async wrapper for retrieve_node
        async def retrieve_wrapper(state: AgentState):
            return await retrieve_node(state, self.vector_store)
        
        # Add Nodes
        workflow.add_node("retrieve", retrieve_wrapper)
        workflow.add_node("agent", lambda state: agent_node(state, self.llm))
        workflow.add_node("tools", self.tool_node)
        
        # Add Edges
        workflow.set_entry_point("retrieve")
        workflow.add_edge("retrieve", "agent")
        
        # Conditional Edge for Tools
        def should_continue(state: AgentState):
            last_message = state["messages"][-1]
            if isinstance(last_message, AIMessage) and last_message.tool_calls:
                return "tools"
            return END
            
        workflow.add_conditional_edges(
            "agent",
            should_continue,
            {
                "tools": "tools",
                END: END
            }
        )
        
        workflow.add_edge("tools", "agent") # Loop back to agent after tool usage
        
        return workflow.compile()

    async def astream_log(self, inputs, config):
        """Proxy to properly expose the streaming capabilities if needed."""
        # This is a bit advanced, for now we will use standard invoke/stream methods from the compiled graph
        return self.graph.astream(inputs, config=config)

