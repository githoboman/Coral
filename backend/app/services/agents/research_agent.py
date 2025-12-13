import logging
import operator
from typing import Annotated, TypedDict, List, Union, Any

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import BaseMessage, SystemMessage, HumanMessage, AIMessage
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode

from app.core.config import settings
from app.services.agents.tools import get_agent_tools
from app.schemas.agent import AgentType, WorkflowEvent, WorkflowEventType

logger = logging.getLogger(__name__)

# --- State ---
class ResearchState(TypedDict):
    messages: Annotated[List[BaseMessage], operator.add]
    research_plan: List[str]
    current_step_index: int
    final_report: str
    user_id: str

# --- Agent Class ---
class ResearchAgent:
    """
    Paid agent that performs deep research in steps.
    Streams 'WorkflowEvent' to update UI progress bars.
    """
    def __init__(self):
        self.llm = ChatGoogleGenerativeAI(
            model=settings.LLM_MODEL,
            google_api_key=settings.GEMINI_API_KEY,
            temperature=0.3
        )
        self.tools = get_agent_tools()
        self.tools_node = ToolNode(self.tools)
        self.llm_with_tools = self.llm.bind_tools(self.tools)
        self.graph = self._build_graph()

    def _build_graph(self):
        workflow = StateGraph(ResearchState)
        
        workflow.add_node("planner", self._plan_research)
        workflow.add_node("step_executor", self._execute_step)
        workflow.add_node("tools", self.tools_node)
        workflow.add_node("synthesizer", self._synthesize_report)
        
        workflow.set_entry_point("planner")
        
        workflow.add_edge("planner", "step_executor")
        
        # Conditional edge for steps
        def check_step_completion(state: ResearchState):
            messages = state["messages"]
            last_msg = messages[-1]
            
            # If tool call, go to tools
            if isinstance(last_msg, AIMessage) and last_msg.tool_calls:
                return "tools"
            
            # If step finished, go to next step or finish
            current_idx = state.get("current_step_index", 0)
            plan = state.get("research_plan", [])
            
            if current_idx >= len(plan) - 1:
                return "synthesizer"
            else:
                return "step_executor" # Continue execution or next step logic needs refinement
            
        # Simplified Logic for this version:
        # Planner -> Loop through steps -> Synthesizer
        # To keep it robust, we'll let the LLM decide if it's done with a step.
        
        # ACTUALLY, strict step-by-step is better for the UI "Progress Bar".
        # Let's model: Planner creates plan. Step Executor runs ONE step. 
        # But we need a loop that increments the index.
        
        pass 
        # Implementation Detail: simpler graph for now
        # Research Node -> Tool Node -> Research Node -> End
        # We will emit events manually within the nodes.
        
        workflow2 = StateGraph(ResearchState)
        workflow2.add_node("researcher", self._run_research)
        workflow2.add_node("tools", self.tools_node)
        
        workflow2.set_entry_point("researcher")
        
        def should_continue(state):
             last = state["messages"][-1]
             if isinstance(last, AIMessage) and last.tool_calls:
                 return "tools"
             return END
             
        workflow2.add_conditional_edges("researcher", should_continue, {"tools": "tools", END: END})
        workflow2.add_edge("tools", "researcher")
        
        return workflow2.compile()

    async def _plan_research(self, state: ResearchState):
        # Placeholder for complex planner
        return {"research_plan": ["Analyze Token", "Check Sentiment"], "current_step_index": 0}

    async def _run_research(self, state: ResearchState):
        """
        Main research loop. 
        Note: To achieve the 'Progress Bar' UI effect, we need to instruct the LLM 
        to explicitely mention what stepping it's doing, or we parse its thought process.
        
        Better yet, we yield a specific 'WorkflowEvent' before calling the LLM.
        """
        # yield WorkflowEvent(type=WorkflowEventType.STEP_START, agent=AgentType.RESEARCH, step="Analyzing data...")
        # LangGraph nodes format: return state update.
        # Events are emitted via astream_events side-channel.
        
        messages = state["messages"]
        system_msg = """You are an expert Crypto Researcher.
        Conduct a deep dive. use tools.
        Structure your reasoning."""
        
        # Simple invocation
        # We will rely on stream_events in the router to pick up tool usage as "steps".
        response = await self.llm_with_tools.ainvoke([SystemMessage(content=system_msg)] + messages)
        return {"messages": [response]}
    
    async def _execute_step(self, state):
        current_idx = state.get("current_step_index", 0)
        plan = state.get("research_plan", [])
        step_name = plan[current_idx]
        
        # We can't easily "yield" event here to the router unless we put it in state 
        # and the router reads it.
        # Standard LangGraph way: The Router observes node transitions.
        
        # For the LLM execution:
        msg = f"Execute step {current_idx + 1}: {step_name}"
        response = await self.llm_with_tools.ainvoke(state["messages"] + [HumanMessage(content=msg)])
        
        # Increment index
        return {"messages": [response], "current_step_index": current_idx + 1}
    
    async def _synthesize_report(self, state):
        return {"final_report": "Done"}

# Redefine simplified to ensure it works first try
class ResearchAgentSimple:
    def __init__(self):
        tools = get_agent_tools()
        self.tool_node = ToolNode(tools)
        self.llm = ChatGoogleGenerativeAI(
            model=settings.LLM_MODEL, 
            api_key=settings.GEMINI_API_KEY
        ).bind_tools(tools)
        
        graph = StateGraph(ResearchState)
        graph.add_node("agent", self.call_model)
        graph.add_node("tools", self.tool_node)
        graph.set_entry_point("agent")
        
        def should_continue(state):
            last = state["messages"][-1]
            if isinstance(last, AIMessage) and last.tool_calls:
                return "tools"
            return END
            
        graph.add_conditional_edges("agent", should_continue, ["tools", END])
        graph.add_edge("tools", "agent")
        self.graph = graph.compile()

    async def call_model(self, state):
        messages = state["messages"]
        system = """You are the Research Agent. Perform a deep dive on the user's request.
        Break it down into steps: Whitepaper, Team, Tokenomics, Sentiment.
        Use the search tool for each step.
        Summarize at the end."""
        
        if not any(isinstance(m, SystemMessage) for m in messages):
            messages = [SystemMessage(content=system)] + messages
            
        response = await self.llm.ainvoke(messages)
        return {"messages": [response]}
