from typing import TypedDict

class AgentState(TypedDict):
    query: str
    context: str
    response: str | None

def alerts_agent(state: AgentState):
    query = state["query"]
    # Dummy implementation for now
    return {
        "response": f"Alert agent processed: '{query}' — (placeholder logic)."
    }
