# app/services/agents/general_agent.py
import logging
import asyncio
from typing import Dict, List, Optional
from datetime import datetime
import random

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from pydantic import BaseModel
from app.core.config import settings

logger = logging.getLogger(__name__)


class ConversationType:
    """Enum-like class for conversation types."""
    GREETING = "greeting"
    CAPABILITY = "capability"
    GRATITUDE = "gratitude"
    CONVERSATION = "conversation"


class GeneralAgent:
    """
    Production-ready general conversation agent with proper async handling.
    Handles greetings, capability questions, and general conversation.
    """

    def __init__(self):
        self._llm: Optional[ChatGoogleGenerativeAI] = None
        self._llm_lock = asyncio.Lock()

        self.system_context = """
You are Tovira, an AI-powered Web3 companion and crypto sidekick built on the Sui blockchain.

**Your Core Capabilities:**
1.  Market Insights - Analyze tokens, sentiment, and trends
2.  Smart Alerts - Set price alerts and track wallets
3.  Web3 Intelligence - Research protocols, TVL, and DeFi
4.  Friendly Conversation - Answer questions and provide guidance

**Your Personality:**
- Professional yet approachable
- Knowledgeable about crypto and Web3
- Helpful and proactive
- Concise and clear in communication

**Guidelines:**
- Keep responses under 200 words unless detailed explanation is needed
- Use emojis sparingly (1-2 per response)
- Be honest about limitations
- Suggest relevant features when appropriate
"""

        # Initialize prompts
        self.prompts = {
            "conversation": self._build_conversation_prompt(),
            "greeting": self._build_greeting_prompt(),
            "capability": self._build_capability_prompt()
        }

    async def _get_llm(self) -> ChatGoogleGenerativeAI:
        """Lazy initialization of LLM with thread safety."""
        if self._llm is None:
            async with self._llm_lock:
                if self._llm is None:
                    try:
                        self._llm = ChatGoogleGenerativeAI(
                            model="gemini-2.0-flash",
                            temperature=0.7,
                            google_api_key=settings.GEMINI_API_KEY,
                            max_retries=2,
                            request_timeout=20.0,
                        )
                        logger.info("General agent LLM initialized")
                    except Exception as e:
                        logger.exception(
                            "Failed to initialize general agent LLM")
                        raise
        return self._llm

    def _build_conversation_prompt(self) -> ChatPromptTemplate:
        return ChatPromptTemplate.from_messages([
            ("system", self.system_context),
            ("human",
             "Conversation context:\n{context}\n\nCurrent message: {query}\n\nRespond as Tovira:")
        ])

    def _build_greeting_prompt(self) -> ChatPromptTemplate:
        return ChatPromptTemplate.from_messages([
            ("system", self.system_context),
            ("human", """The user just greeted you: "{query}"

Respond warmly:
1. Greet them back
2. Briefly introduce yourself (1 sentence)
3. Ask what they'd like help with OR suggest a use case

Keep it friendly and concise (max 4 sentences).

Response:""")
        ])

    def _build_capability_prompt(self) -> ChatPromptTemplate:
        return ChatPromptTemplate.from_messages([
            ("system", self.system_context),
            ("human", """The user is asking about your capabilities: "{query}"

Context: {context}

Explain what you can do:
- Be specific about features that match their interest
- Give 1-2 concrete examples
- Invite them to try a feature

Keep it engaging and actionable (max 200 words).

Response:""")
        ])

    def _classify_query_type(self, query: str) -> str:
        """Classify the type of conversation."""
        query_lower = query.lower().strip()

        # Greeting detection
        greetings = [
            "hi", "hello", "hey", "greetings", "good morning",
            "good afternoon", "good evening", "sup", "yo",
            "what's up", "howdy", "hiya"
        ]
        if any(query_lower.startswith(g) for g in greetings) or query_lower in greetings:
            return ConversationType.GREETING

        # Capability questions
        capability_keywords = [
            "what can you", "what do you do", "how can you help",
            "what are you", "what's your", "tell me about yourself",
            "features", "capabilities", "how does tovira work",
            "what is tovira", "who are you"
        ]
        if any(kw in query_lower for kw in capability_keywords):
            return ConversationType.CAPABILITY

        # Gratitude
        if any(word in query_lower for word in ["thank", "thanks", "appreciate", "thx"]):
            return ConversationType.GRATITUDE

        return ConversationType.CONVERSATION

    async def _handle_greeting(self, query: str) -> str:
        """Handle greeting with personalized response."""
        try:
            llm = await self._get_llm()
            chain = self.prompts["greeting"] | llm | StrOutputParser()

            result = await asyncio.wait_for(
                chain.ainvoke({"query": query}),
                timeout=8.0
            )
            return result.strip()

        except asyncio.TimeoutError:
            logger.warning("Greeting handler timeout")
            return self._get_fallback_greeting()
        except Exception as e:
            logger.error(f"Greeting handling error: {e}")
            return self._get_fallback_greeting()

    def _get_fallback_greeting(self) -> str:
        """Fallback greeting responses."""
        greetings = [
            " Hey there! I'm Tovira, your AI-powered Web3 companion. I can help you with market insights, alerts, and crypto research. What would you like to explore?",
            "Hello! I'm Tovira, here to help you navigate the crypto world. Whether you need market analysis, price alerts, or Web3 intelligence, I've got you covered. What can I do for you?",
            "Hi! Tovira here, your crypto sidekick. I can analyze markets, set up alerts, and research protocols. What are you interested in today?"
        ]
        return random.choice(greetings)

    async def _handle_capability(self, query: str, context: str) -> str:
        """Handle capability questions."""
        try:
            llm = await self._get_llm()
            chain = self.prompts["capability"] | llm | StrOutputParser()

            result = await asyncio.wait_for(
                chain.ainvoke({"query": query, "context": context}),
                timeout=10.0
            )
            return result.strip()

        except asyncio.TimeoutError:
            logger.warning("Capability handler timeout")
            return self._get_default_capabilities()
        except Exception as e:
            logger.error(f"Capability handling error: {e}")
            return self._get_default_capabilities()

    def _get_default_capabilities(self) -> str:
        """Default capabilities response."""
        return """
 **What Tovira Can Do for You:**

** Market Insights**
Analyze any token, get sentiment analysis, and understand market trends.
Try: *"Analyze SUI token"* or *"What's the sentiment on Bitcoin?"*

** Smart Alerts**
Set price alerts, track wallets, and get notified about important events.
Try: *"Alert me when BTC hits $100k"*

** Web3 Intelligence**
Research protocols, check TVL, and explore DeFi opportunities.
Try: *"Tell me about Uniswap"* or *"What's the TVL on Sui?"*

** General Crypto Guidance**
Ask questions, get explanations, and explore the crypto world.

What would you like to try first?
""".strip()

    def _handle_gratitude(self) -> str:
        """Handle thank you messages."""
        responses = [
            "You're welcome! Happy to help. Let me know if you need anything else! ",
            "Glad I could assist! Feel free to ask anytime. ",
            "My pleasure! That's what I'm here for. What else can I help with?",
            "Anytime! Don't hesitate to reach out if you have more questions. ",
            "You're very welcome! I'm always here to help with your crypto needs. "
        ]
        return random.choice(responses)

    async def _handle_conversation(self, query: str, context: str) -> str:
        """Handle general conversation."""
        try:
            llm = await self._get_llm()
            chain = self.prompts["conversation"] | llm | StrOutputParser()

            result = await asyncio.wait_for(
                chain.ainvoke({"query": query, "context": context}),
                timeout=15.0
            )
            return result.strip()

        except asyncio.TimeoutError:
            logger.error("Conversation handler timeout")
            return "⏱️ Sorry, that took too long. Could you rephrase your question?"
        except Exception as e:
            logger.error(f"Conversation handling error: {e}")
            return "I'm having trouble processing that. Could you try asking in a different way?"

    async def analyze(self, query: str, context: str = "") -> str:
        """
        Main entry point for general conversation analysis.

        Args:
            query: User's message
            context: Conversation context as string

        Returns:
            Response string
        """
        try:
            # Classify query type
            query_type = self._classify_query_type(query)
            logger.info(f"General agent handling: {query_type}")

            # Route to appropriate handler
            if query_type == ConversationType.GREETING:
                return await self._handle_greeting(query)

            elif query_type == ConversationType.CAPABILITY:
                return await self._handle_capability(query, context)

            elif query_type == ConversationType.GRATITUDE:
                return self._handle_gratitude()

            else:  # CONVERSATION
                return await self._handle_conversation(query, context)

        except Exception as e:
            logger.error(f"General agent error: {e}")
            return "I encountered an issue processing your message. Let's try again - how can I help you today?"


# === Global Instance ===
_general_agent = GeneralAgent()


# === Async Entry Point (Required by base_agent.py) ===
async def general_agent_async(state: Dict) -> Dict:
    """
    Async entry point for general conversation.

    Args:
        state: Dictionary containing 'query' and 'context'

    Returns:
        Dictionary with 'response' key
    """
    query = state.get("query", "")
    context = state.get("context", "")

    if not query.strip():
        return {
            "response": "I'm here to help! What would you like to know about crypto or Web3?"
        }

    try:
        # Call the core async analysis function
        response_text = await _general_agent.analyze(query, context)

        return {"response": response_text}

    except Exception as e:
        logger.error(f"General agent wrapper error: {e}")
        return {
            "response": "  I encountered an error. Please rephrase your question."
        }
