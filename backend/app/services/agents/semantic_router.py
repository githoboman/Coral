# app/services/agents/semantic_router.py
"""
Semantic Router using Sentence Transformers for intent classification.
This replaces expensive LLM calls with fast, free local embeddings.
"""
import numpy as np
from sentence_transformers import SentenceTransformer
from typing import Dict, List, Tuple
import logging

logger = logging.getLogger(__name__)

class SemanticRouter:
    """
    Intent classifier using sentence embeddings and cosine similarity.
    Fast, free, and runs locally without API calls.
    """
    
    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        """
        Initialize the semantic router with a sentence transformer model.
        
        Args:
            model_name: HuggingFace model name (default: all-MiniLM-L6-v2, 80MB)
        """
        logger.info(f"Loading sentence transformer model: {model_name}")
        self.model = SentenceTransformer(model_name)
        
        # Define intent examples for each category
        self.intent_examples = {
            "chat": [
                "hello", "hi", "hey", "good morning", "how are you",
                "what can you do", "help", "thanks", "thank you",
                "tell me about yourself", "who are you", "what is tovira"
            ],
            "research": [
                "research SUI token", "analyze price trends", "find top DeFi protocols",
                "what is the price of", "show me token analysis", "search for",
                "tell me about", "explain", "how does it work", "what are the best",
                "compare tokens", "market analysis", "token metrics"
            ],
            "task": [
                "create a task", "add to my todo", "schedule a meeting",
                "plan an event", "organize", "set up", "create event",
                "add event", "calendar", "schedule", "plan"
            ],
            "alert": [
                "remind me to", "set a reminder", "alert me when", "notify me",
                "create an alert", "wake me up", "don't forget", "remember to",
                "set alarm", "notification for"
            ],
            "wallet": [
                "check my balance", "show my wallet", "transaction history",
                "how much do I have", "my portfolio", "wallet address",
                "send tokens", "transfer", "swap"
            ]
        }
        
        # Pre-compute embeddings for all examples
        logger.info("Pre-computing intent embeddings...")
        self.intent_embeddings = {}
        for intent, examples in self.intent_examples.items():
            embeddings = self.model.encode(examples, convert_to_numpy=True)
            self.intent_embeddings[intent] = embeddings
        
        logger.info(f"Semantic router initialized with {len(self.intent_examples)} intents")
    
    def _cosine_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        """Calculate cosine similarity between two vectors."""
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))
    
    def classify(self, query: str, threshold: float = 0.5) -> Tuple[str, float]:
        """
        Classify a query into an intent category.
        
        Args:
            query: User's query text
            threshold: Minimum confidence threshold (0.0 to 1.0)
        
        Returns:
            Tuple of (intent, confidence_score)
        """
        # Encode the query
        query_embedding = self.model.encode(query, convert_to_numpy=True)
        
        # Calculate similarity with all intent examples
        intent_scores = {}
        for intent, embeddings in self.intent_embeddings.items():
            # Calculate similarity with each example and take the max
            similarities = [
                self._cosine_similarity(query_embedding, example_emb)
                for example_emb in embeddings
            ]
            intent_scores[intent] = max(similarities)
        
        # Get the best matching intent
        best_intent = max(intent_scores, key=intent_scores.get)
        confidence = intent_scores[best_intent]
        
        # If confidence is below threshold, return "chat" as fallback
        if confidence < threshold:
            logger.info(f"Low confidence ({confidence:.2f}) for query: '{query[:50]}...'")
            return "chat", confidence
        
        logger.info(f"Classified '{query[:50]}...' as '{best_intent}' (confidence: {confidence:.2f})")
        return best_intent, confidence
    
    def get_agent_for_intent(self, intent: str) -> str:
        """
        Map intent to agent type.
        
        Args:
            intent: Intent category
        
        Returns:
            Agent type string
        """
        intent_to_agent = {
            "chat": "tovira_main",
            "research": "research_agent",
            "task": "alert_agent",  # Unified with alert
            "alert": "alert_agent",
            "wallet": "wallet_tracker"
        }
        return intent_to_agent.get(intent, "tovira_main")
    
    def requires_fee(self, intent: str, agent: str) -> bool:
        """
        Determine if an intent/agent requires a fee.
        
        Args:
            intent: Intent category
            agent: Agent type
        
        Returns:
            Boolean indicating if fee is required
        """
        # Research agent requires fee
        if agent == "research_agent":
            return True
        return False
    
    def estimate_cost(self, intent: str, agent: str) -> float:
        """
        Estimate the cost for an operation.
        
        Args:
            intent: Intent category
            agent: Agent type
        
        Returns:
            Estimated cost in SUI
        """
        if agent == "research_agent":
            return 0.001  # 0.001 SUI for research operations
        return 0.0


# Global instance (lazy loaded)
_semantic_router = None

def get_semantic_router() -> SemanticRouter:
    """Get or create the global semantic router instance."""
    global _semantic_router
    if _semantic_router is None:
        _semantic_router = SemanticRouter()
    return _semantic_router
