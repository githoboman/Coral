from enum import Enum
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field

class AgentType(str, Enum):
    MAIN = "tovira_main"
    RESEARCH = "research_agent"
    TASK = "task_agent"
    ALERT = "alert_agent"
    WALLET_TRACKER = "wallet_tracker"
    PORTFOLIO = "portfolio_guardian"
    DEGEN = "degen_agent"
    NFT = "nft_agent"

class IntentType(str, Enum):
    RESEARCH = "research" # Paid
    TASK = "task"         # Free
    ALERT = "alert"       # Free
    TRACKING = "tracking" # Paid
    CHAT = "chat"         # Free
    UNKNOWN = "unknown"

class RouterResponse(BaseModel):
    intent: IntentType
    target_agent: AgentType
    requires_fee: bool
    estimated_cost: float = 0.0 # In SUI
    reason: str
    
    class Config:
        use_enum_values = True  # Serialize enums by value, not name

class WorkflowEventType(str, Enum):
    STEP_START = "step_start"
    STEP_COMPLETE = "step_complete"
    ERROR = "error"
    INFO = "info"

class WorkflowEvent(BaseModel):
    type: WorkflowEventType
    agent: AgentType
    step: str
    details: Optional[Dict[str, Any]] = None
    timestamp: Optional[str] = None
