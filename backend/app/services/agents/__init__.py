# app/services/agents/__init__.py

"""
Tovira Multi-Agent System
=========================
This package defines all AI agents and orchestration logic used in the Tovira backend server.

Agents:
    - CoordinatorAgent (base_agent.py)  → Routes & merges sub-agents
    - InsightsAgent (insights_agent.py) → Market & token analysis
    - AlertsAgent (alerts_agent.py)     → Crypto alert creation
    - Web3Agent (web3_agent.py)         → On-chain data fetching
    - GeneralAgent (general_agent.py)   → Default conversational LLM

Each agent returns a dict:
    { "response": str, "metadata": dict }

All agents are orchestrated via LangGraph in `base_agent.py`.
"""

from .insights_agent import insights_agent
from .alerts_agent import alerts_agent
from .web3_agent import web3_agent
from .general_agent import general_agent

__all__ = [
    "insights_agent",
    "alerts_agent",
    "web3_agent",
    "general_agent",
]
