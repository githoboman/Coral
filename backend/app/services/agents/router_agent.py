import logging
import json
from enum import Enum
from typing import Optional

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser

from app.core.config import settings
from app.schemas.agent import AgentType, IntentType, RouterResponse

# Try to import semantic router, but make it optional
try:
    from app.services.agents.semantic_router import get_semantic_router
    SEMANTIC_ROUTER_AVAILABLE = True
except ImportError:
    SEMANTIC_ROUTER_AVAILABLE = False
    logger = logging.getLogger(__name__)
    logger.warning("sentence-transformers not installed, using LLM-only routing")

logger = logging.getLogger(__name__)


def extract_json_from_response(content: str) -> str:
    """Extract JSON from response, handling markdown code blocks."""
    content = content.strip()
    
    # Remove markdown code blocks if present
    if content.startswith("```json"):
        content = content[7:]  # Remove ```json
    elif content.startswith("```"):
        content = content[3:]  # Remove ```
    
    if content.endswith("```"):
        content = content[:-3]  # Remove trailing ```
    
    return content.strip()

class RouterAgent:
    """
    Hybrid router using semantic classification (fast, free) with LLM fallback (accurate).
    Goal: <100ms for most queries, <800ms for edge cases.
    """
    def __init__(self):
        # Semantic router for fast, free classification (if available)
        if SEMANTIC_ROUTER_AVAILABLE:
            self.semantic_router = get_semantic_router()
        else:
            self.semantic_router = None
        
        # LLM for fallback on low-confidence cases
        self.llm = ChatGoogleGenerativeAI(
            model=settings.LLM_MODEL, 
            google_api_key=settings.GEMINI_API_KEY,
            temperature=0.0,
            max_output_tokens=512,
        )
        
        # Define the JSON schema for the response
        self.response_schema = {
            "type": "object",
            "properties": {
                "intent": {
                    "type": "string",
                    "enum": ["research", "task", "alert", "tracking", "chat", "unknown"]
                },
                "target_agent": {
                    "type": "string",
                    "enum": ["tovira_main", "research_agent", "task_agent", "alert_agent", "wallet_tracker", "portfolio_guardian", "degen_agent", "nft_agent"]
                },
                "requires_fee": {
                    "type": "boolean"
                },
                "estimated_cost": {
                    "type": "number"
                },
                "reason": {
                    "type": "string"
                }
            },
            "required": ["intent", "target_agent", "requires_fee", "estimated_cost", "reason"]
        }

        self.system_prompt = """You are Tovira's Router. Classify user requests and determine fees.

AGENTS & FEES:
- Research Agent (0.0008 SUI): Deep analysis, token research, market reports
- Wallet Tracker (0.001 SUI): Track wallets, analyze addresses, whale watching
- Task Agent (FREE): Buy/sell tokens, swaps, limit orders, automations
- Alert Agent (FREE): Price alerts, notifications, monitoring
- Degen Agent (FREE check, paid execution): Snipe tokens, meme trading
- Main Agent (FREE): General chat, questions, unclear requests

Query: {query}
Context: {current_agent}

Return JSON with intent, target_agent, requires_fee, estimated_cost, and brief reason."""

    async def route_request(self, query: str, current_agent: AgentType = AgentType.MAIN) -> RouterResponse:
        try:
            # Validate query is not empty
            if not query or not query.strip():
                logger.warning("Empty query received, returning default response")
                return RouterResponse(
                    intent=IntentType.CHAT, 
                    target_agent=AgentType.MAIN, 
                    requires_fee=False,
                    estimated_cost=0.0,
                    reason="Empty query, defaulting to chat."
                )
            
            # Step 1: Try semantic router first (fast, free) - if available
            if self.semantic_router:
                intent, confidence = self.semantic_router.classify(query, threshold=0.5)
                
                # Step 2: If confidence is high enough, use semantic router result
                if confidence >= 0.7:
                    agent = self.semantic_router.get_agent_for_intent(intent)
                    requires_fee = self.semantic_router.requires_fee(intent, agent)
                    estimated_cost = self.semantic_router.estimate_cost(intent, agent)
                    
                    logger.info(f"Semantic router: '{query[:50]}...' -> {intent} ({agent}) [confidence: {confidence:.2f}]")
                    
                    return RouterResponse(
                        intent=IntentType(intent) if intent in [e.value for e in IntentType] else IntentType.CHAT,
                        target_agent=AgentType(agent),
                        requires_fee=requires_fee,
                        estimated_cost=estimated_cost,
                        reason=f"Classified as {intent} with {confidence:.0%} confidence (semantic router)"
                    )
                
                # Step 3: Low confidence - fallback to LLM for accuracy
                logger.info(f"Low confidence ({confidence:.2f}), using LLM fallback for: '{query[:50]}...'")
            else:
                # Semantic router not available, use LLM directly
                logger.info(f"Semantic router not available, using LLM for: '{query[:50]}...'")
            
            return await self._llm_classify(query, current_agent)
            
        except Exception as e:
            logger.error(f"Router failed: {e}", exc_info=True)
            # Fail safe: Default to Main Agent, Free Chat
            return RouterResponse(
                intent=IntentType.CHAT, 
                target_agent=AgentType.MAIN, 
                requires_fee=False,
                estimated_cost=0.0,
                reason="Router error, defaulting to safe mode."
            )
    
    async def _llm_classify(self, query: str, current_agent: AgentType) -> RouterResponse:
        """Fallback LLM classification for low-confidence cases."""
        try:
            # Configure LLM for JSON mode
            llm_with_json = self.llm.bind(
                response_mime_type="application/json",
                response_schema=self.response_schema
            )
            
            # Create the full prompt as a HumanMessage
            from langchain_core.messages import HumanMessage
            
            full_prompt = self.system_prompt.format(
                query=query.strip(),
                current_agent=current_agent.value
            )
            
            messages = [HumanMessage(content=full_prompt)]
            
            # Invoke with JSON mode
            raw_response = await llm_with_json.ainvoke(messages)
            logger.info(f"LLM fallback response: {raw_response.content}")
            
            # Parse the JSON response
            cleaned_content = extract_json_from_response(raw_response.content)
            result = json.loads(cleaned_content)
            
            if not result or result == {}:
                raise ValueError("Empty result from LLM")
            
            return RouterResponse(**result)
            
        except Exception as e:
            logger.error(f"LLM fallback failed: {e}")
            return RouterResponse(
                intent=IntentType.CHAT, 
                target_agent=AgentType.MAIN, 
                requires_fee=False,
                estimated_cost=0.0,
                reason="LLM fallback failed, defaulting to chat."
            )

