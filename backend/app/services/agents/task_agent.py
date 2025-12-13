import logging
import operator
from typing import Annotated, TypedDict, List, Dict, Any, Union, Literal

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import BaseMessage, SystemMessage, AIMessage
from langchain_core.output_parsers import JsonOutputParser
from pydantic import BaseModel, Field
from langgraph.graph import StateGraph, END

from app.core.config import settings
# Import schemas to ensure alignment
from app.schemas.task import TaskBase
from app.schemas.event import EventBase

logger = logging.getLogger(__name__)

# --- Schemas ---
class AgentActionPayload(BaseModel):
    action_type: Literal["create_task", "create_event"] = Field(
        description="The type of entity to create. Use 'create_event' for meetings, reminders, and SPECIFIC TIMED ALERTS. Use 'create_task' for general to-dos, limit orders, or actions without a strict calendar slot."
    )
    # We use Dict here because Union handling in JsonOutputParser can be tricky without a discriminator
    # The system prompt will enforce the fields.
    data: Dict[str, Any] = Field(
        description="The payload matching either TaskBase or EventBase schema."
    )
    confirmation_message: str = Field(description="User facing summary.")

# --- State ---
class TaskState(TypedDict):
    messages: Annotated[List[BaseMessage], operator.add]
    payload: Dict[str, Any]

# --- Agent ---
class TaskAgent:
    """
    Agent that structures natural language into valid Task or Event payloads
    compatible with `api/routers/tasks.py` and `api/routers/events.py`.
    """
    def __init__(self):
        self.llm = ChatGoogleGenerativeAI(
            model=settings.LLM_MODEL, 
            google_api_key=settings.GEMINI_API_KEY,
            temperature=0.0
        )
        self.parser = JsonOutputParser(pydantic_object=AgentActionPayload)
        self.graph = self._build_graph()

    def _build_graph(self):
        workflow = StateGraph(TaskState)
        workflow.add_node("construct", self._construct_payload)
        workflow.set_entry_point("construct")
        workflow.add_edge("construct", END)
        return workflow.compile()

    async def _construct_payload(self, state):
        messages = state["messages"]
        system_prompt = f"""You are the Task & Event Agent for Tovira.
Your goal is to convert user requests into structured JSON for creating Tasks or Events.

### RULES:
1. **Events**: Use for things with a specific DATE and TIME, meetings, or Alerts that act as reminders.
   - Schema: `event_name` (req), `event_date` (ISO req), `event_time` (HH:MM), `is_all_day`, `location`, `description`, `color`.
   - NOTE: "Alert me at 5pm" is an Event. "Meeting with Bob" is an Event.
   
2. **Tasks**: Use for to-dos, shopping lists, or abstract goals like "Limit Order".
   - Schema: `task_name` (req), `due_date` (ISO), `priority` (low/medium/high), `tags`, `description`.
   - NOTE: "Buy SUI" is a Task. "Remind me to buy milk" is a Task (with due date).

### OUTPUT FORMAT:
Return JSON valid against this schema:
{{
  "action_type": "create_task" | "create_event",
  "data": {{ ...fields matching the chosen schema... }},
  "confirmation_message": "Short summary for user"
}}

### EXAMPLES:
User: "Remind me to check SUI price tomorrow at 9am"
Output:
{{
  "action_type": "create_task",
  "data": {{
    "task_name": "Check SUI Price",
    "due_date": "2025-10-12T09:00:00",
    "priority": "high",
    "tags": ["alert", "crypto"]
  }},
  "confirmation_message": "I've set a task to check SUI price tomorrow at 9am."
}}

User: "Schedule a launch party for Tovira on Friday at 8pm"
Output:
{{
  "action_type": "create_event",
  "data": {{
    "event_name": "Tovira Launch Party",
    "event_date": "2025-10-15T20:00:00",
    "event_time": "20:00",
    "color": "bg-purple-500"
  }},
  "confirmation_message": "Event 'Tovira Launch Party' scheduled for Friday."
}}
"""
        chain = self.llm | self.parser
        
        try:
            response = await chain.ainvoke([SystemMessage(content=system_prompt)] + messages)
            return {"payload": response}
            
        except Exception as e:
            logger.error(f"Task construction failed: {e}")
            return {"payload": {"error": str(e)}}
