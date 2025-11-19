# app/services/agents/base_agent.py
import re
import logging
import json
from typing import AsyncGenerator, Dict, Any, List, Optional
from datetime import datetime
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_community.tools.tavily_search import TavilySearchResults
from langchain_core.tools import tool
from pydantic import BaseModel, Field
import httpx
import asyncio
from app.core.config import settings

logger = logging.getLogger(__name__)


# ============================================================================
# STATE DEFINITIONS
# ============================================================================

class ResearchState(BaseModel):
    """State for the research agent workflow"""
    messages: List[Dict[str, Any]] = Field(default_factory=list)
    query: str = ""
    user_id: str = ""
    project_name: str = ""
    research_goal: str = ""

    # Research outputs by pillar
    selling_points: Dict[str, Any] = Field(default_factory=dict)
    fundamentals: Dict[str, Any] = Field(default_factory=dict)
    technical: Dict[str, Any] = Field(default_factory=dict)
    onchain: Dict[str, Any] = Field(default_factory=dict)
    progress: List[str] = Field(default_factory=list)
    
    # Process tracking
    current_pillar: str = ""
    completed_pillars: List[str] = Field(default_factory=list)
    iteration_count: int = 0
    max_iterations: int = 15

    # Final output
    final_report: str = ""
    confidence_score: float = 0.0


# ============================================================================
# TOOLS FOR WEB3 RESEARCH
# ============================================================================

@tool
async def web_search(query: str, num_results: int = 5) -> str:
    """
    Search the web for information about Sui blockchain projects.

    Args:
        query: Search query string
        num_results: Number of results to return (default: 5)

    Returns:
        JSON string with search results
    """
    try:
        # Using a simple search API - replace with your preferred search service
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Placeholder - integrate with actual search API
            logger.info(f"Web search: {query}")
            return json.dumps({
                "query": query,
                "results": [
                    {"title": "Example Result", "snippet": "Placeholder search result",
                        "url": "https://example.com"}
                ]
            })
    except Exception as e:
        logger.error(f"Web search error: {e}")
        return json.dumps({"error": str(e)})


@tool
async def browse_page(url: str, instructions: str = "") -> str:
    """
    Browse a webpage and extract specific information.

    Args:
        url: URL to browse
        instructions: Specific extraction instructions

    Returns:
        Extracted content as string
    """
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(url)
            content = response.text[:5000]  # Limit content size
            logger.info(f"Browsed page: {url}")
            return f"Content from {url}:\n{content}\n\nInstructions: {instructions}"
    except Exception as e:
        logger.error(f"Browse page error: {e}")
        return f"Error browsing {url}: {str(e)}"


@tool
async def sui_onchain_data(project_name: str, metric: str = "all") -> str:
    """
    Fetch on-chain data for Sui projects using BlockVision API.

    Args:
        project_name: Name of the Sui project
        metric: Specific metric to fetch (tvl, volume, users, all)

    Returns:
        JSON string with on-chain metrics
    """
    try:
        if not settings.BLOCKVISION_API_KEY:
            return json.dumps({"error": "BlockVision API key not configured"})

        headers = {"X-API-KEY": settings.BLOCKVISION_API_KEY}
        base_url = settings.BLOCKVISION_BASE_URL

        async with httpx.AsyncClient(timeout=15.0) as client:
            # Fetch project data
            response = await client.get(
                f"{base_url}/projects/{project_name}/metrics",
                headers=headers
            )

            if response.status_code == 200:
                data = response.json()
                logger.info(f"Fetched on-chain data for {project_name}")
                return json.dumps(data, indent=2)
            else:
                return json.dumps({"error": f"API error: {response.status_code}"})

    except Exception as e:
        logger.error(f"Sui on-chain data error: {e}")
        return json.dumps({"error": str(e), "metric": metric})


@tool
async def coingecko_data(token_id: str) -> str:
    """
    Fetch token data from CoinGecko API.

    Args:
        token_id: CoinGecko token ID

    Returns:
        JSON string with token data
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            url = f"https://api.coingecko.com/api/v3/coins/{token_id}"
            params = {"localization": "false",
                      "tickers": "false", "community_data": "false"}

            if settings.COINGECKO_API_KEY:
                params["x_cg_demo_api_key"] = settings.COINGECKO_API_KEY

            response = await client.get(url, params=params)

            if response.status_code == 200:
                data = response.json()
                logger.info(f"Fetched CoinGecko data for {token_id}")
                return json.dumps({
                    "name": data.get("name"),
                    "symbol": data.get("symbol"),
                    "price_usd": data.get("market_data", {}).get("current_price", {}).get("usd"),
                    "market_cap": data.get("market_data", {}).get("market_cap", {}).get("usd"),
                    "volume_24h": data.get("market_data", {}).get("total_volume", {}).get("usd"),
                    "price_change_24h": data.get("market_data", {}).get("price_change_percentage_24h")
                }, indent=2)
            else:
                return json.dumps({"error": f"API error: {response.status_code}"})

    except Exception as e:
        logger.error(f"CoinGecko data error: {e}")
        return json.dumps({"error": str(e)})


# ============================================================================
# AGENT NODES
# ============================================================================

class SuiResearchAgent:
    """Deep research agent for Sui blockchain projects"""

    def __init__(self):
        self.llm = ChatGoogleGenerativeAI(
            model=settings.LLM_MODEL,
            google_api_key=settings.GEMINI_API_KEY,
            temperature=settings.LLM_TEMPERATURE,
            streaming=True
        )

        self.tools = [web_search, browse_page,
                      sui_onchain_data, coingecko_data]
        self.tool_node = ToolNode(self.tools)

        # Build the graph
        self.graph = self._build_graph()

    def _build_graph(self) -> StateGraph:
        """Build the LangGraph workflow"""
        workflow = StateGraph(ResearchState)

        # Add nodes
        workflow.add_node("parse_query", self._parse_query)
        workflow.add_node("pillar_1_selling_points",
                          self._research_selling_points)
        workflow.add_node("pillar_2_fundamentals", self._research_fundamentals)
        workflow.add_node("pillar_3_technical", self._research_technical)
        workflow.add_node("pillar_4_onchain", self._research_onchain)
        workflow.add_node("synthesize", self._synthesize_report)
        workflow.add_node("tools", self.tool_node)

        # Define edges
        workflow.set_entry_point("parse_query")
        workflow.add_edge("parse_query", "pillar_1_selling_points")
        workflow.add_edge("pillar_1_selling_points", "pillar_2_fundamentals")
        workflow.add_edge("pillar_2_fundamentals", "pillar_3_technical")
        workflow.add_edge("pillar_3_technical", "pillar_4_onchain")
        workflow.add_edge("pillar_4_onchain", "synthesize")
        workflow.add_edge("synthesize", END)

        return workflow.compile()

    async def _parse_query(self, state: ResearchState) -> ResearchState:
        """Parse user query and extract project details"""
        logger.info(f"Parsing query: {state.query}")

        system_prompt = """You are a Sui blockchain research assistant.
            Extract the project name and research goal from the user's query.

            CRITICAL: Return ONLY a valid JSON object. No markdown, no backticks, no explanations.

            Format:
            {"project_name": "PROJECT_NAME", "research_goal": "GOAL_DESCRIPTION"}

            Examples:
            {"project_name": "SUI", "research_goal": "price trends analysis"}
            {"project_name": "NAVI", "research_goal": "fundamentals research"}
            {"project_name": "Cetus", "research_goal": "security investigation"}

            Extract the project name (default to "SUI" if unclear) and the research objective."""

        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=state.query)
        ]

        try:
            response = await self.llm.ainvoke(messages)
            content = response.content.strip()

            if not content:
                raise ValueError("Empty LLM response")

            logger.debug(f"Raw LLM response: {content}")

            # Direct JSON parse only
            parsed = json.loads(content)

            # Validate parsed result
            if not isinstance(parsed, dict):
                raise ValueError(f"Response is not a JSON object: {type(parsed)}")
        
            project_name = parsed.get("project_name", "").strip()
            research_goal = parsed.get("research_goal", "").strip()

            if not project_name or not research_goal:
                raise ValueError(f"Missing required fields. Got: {parsed}")

            state.project_name = project_name
            state.research_goal = research_goal
            state.progress.append(
                f"🔍 Researching {state.project_name} for {state.research_goal}"
            )
            state.messages.append({
                "role": "assistant",
                "content": f"Researching {state.project_name}..."
            })
            logger.info(f"✅ Successfully parsed: {state.project_name} - {state.research_goal}")
            return state

        except Exception as e:
            error_msg = f"Failed to parse query: {str(e)}. Query: {state.query}"
            logger.error(error_msg)
        
            # Set error state
            state.progress.append("❌ Failed to parse research query")
            state.messages.append({
                "role": "assistant",
                "content": "I encountered an error parsing your research request. Please try rephrasing your query."
            })
        
            raise ValueError(error_msg)    

    async def _research_selling_points(self, state: ResearchState) -> ResearchState:
        """Pillar 1: Research value proposition and selling points"""
        logger.info(f"Researching selling points for {state.project_name}")
        state.current_pillar = "Selling Points"

        system_prompt = f"""Research the value proposition of {state.project_name} on Sui blockchain.
        
        Focus on:
        1. Core product/service and problem solved
        2. Unique selling proposition (USP)
        3. Target audience and use cases
        4. Competitive advantages
        5. Market positioning
        
        Use the available tools to gather information from official sources, documentation, and market analysis.
        Provide a concise summary with confidence score (0-10).
        """

        messages = [SystemMessage(content=system_prompt)]

        # Use tools to gather data
        search_results = await web_search.ainvoke({
            "query": f"{state.project_name} Sui blockchain value proposition USP",
            "num_results": 5
        })

        messages.append(HumanMessage(
            content=f"Web search results: {search_results}"))

        try:
            response = await self.llm.ainvoke(messages)
            state.selling_points = {
                "summary": response.content,
                "confidence": 7.5,
                "timestamp": datetime.utcnow().isoformat()
            }
            state.completed_pillars.append("selling_points")

        except Exception as e:
            logger.error(f"Selling points research error: {e}")
            state.selling_points = {"error": str(e)}

        return state

    async def _research_fundamentals(self, state: ResearchState) -> ResearchState:
        """Pillar 2: Research fundamentals (team, funding, community)"""
        logger.info(f"Researching fundamentals for {state.project_name}")
        state.current_pillar = "Fundamentals"

        system_prompt = f"""Research the fundamental strength of {state.project_name}.
        
        Analyze:
        1. Team background and credibility
        2. Funding rounds and investors
        3. Community size and engagement
        4. Tokenomics and token utility
        5. Roadmap and milestones
        
        Provide a structured analysis with risk flags.
        """

        messages = [SystemMessage(content=system_prompt)]

        # Gather data
        funding_data = await web_search.ainvoke({
            "query": f"{state.project_name} funding investors team Sui",
            "num_results": 5
        })

        messages.append(HumanMessage(content=f"Funding data: {funding_data}"))

        try:
            response = await self.llm.ainvoke(messages)
            state.fundamentals = {
                "analysis": response.content,
                "risk_score": 6.0,
                "timestamp": datetime.utcnow().isoformat()
            }
            state.completed_pillars.append("fundamentals")

        except Exception as e:
            logger.error(f"Fundamentals research error: {e}")
            state.fundamentals = {"error": str(e)}

        return state

    async def _research_technical(self, state: ResearchState) -> ResearchState:
        """Pillar 3: Research technical aspects and security"""
        logger.info(f"Researching technical aspects for {state.project_name}")
        state.current_pillar = "Technical"

        system_prompt = f"""Analyze the technical implementation of {state.project_name} on Sui.
        
        Focus on:
        1. Technical architecture and design
        2. Smart contract security and audits
        3. Sui Move implementation quality
        4. Known vulnerabilities or exploits
        5. Technical tradeoffs and risks
        
        Provide risk matrix and mitigation strategies.
        """

        messages = [SystemMessage(content=system_prompt)]

        # Search for technical data
        tech_data = await web_search.ainvoke({
            "query": f"{state.project_name} Sui Move audit security technical",
            "num_results": 5
        })

        messages.append(HumanMessage(content=f"Technical data: {tech_data}"))

        try:
            response = await self.llm.ainvoke(messages)
            state.technical = {
                "analysis": response.content,
                "security_score": 7.0,
                "timestamp": datetime.utcnow().isoformat()
            }
            state.completed_pillars.append("technical")

        except Exception as e:
            logger.error(f"Technical research error: {e}")
            state.technical = {"error": str(e)}

        return state

    async def _research_onchain(self, state: ResearchState) -> ResearchState:
        """Pillar 4: Research on-chain metrics and activity"""
        logger.info(f"Researching on-chain data for {state.project_name}")
        state.current_pillar = "On-Chain"

        system_prompt = f"""Analyze on-chain metrics for {state.project_name} on Sui.
        
        Examine:
        1. Total Value Locked (TVL)
        2. Active users and transaction volume
        3. Token holder distribution
        4. Liquidity and trading activity
        5. Growth trends and patterns
        
        Provide quantitative analysis with charts/insights.
        """

        messages = [SystemMessage(content=system_prompt)]

        # Fetch on-chain data
        onchain_metrics = await sui_onchain_data.ainvoke({
            "project_name": state.project_name,
            "metric": "all"
        })

        messages.append(HumanMessage(
            content=f"On-chain metrics: {onchain_metrics}"))

        try:
            response = await self.llm.ainvoke(messages)
            state.onchain = {
                "metrics": response.content,
                "health_score": 7.5,
                "timestamp": datetime.utcnow().isoformat()
            }
            state.completed_pillars.append("onchain")

        except Exception as e:
            logger.error(f"On-chain research error: {e}")
            state.onchain = {"error": str(e)}

        return state

    async def _synthesize_report(self, state: ResearchState) -> ResearchState:
        """Synthesize all research into final report"""
        logger.info(f"Synthesizing final report for {state.project_name}")

        system_prompt = f"""Create a comprehensive research report for {state.project_name} on Sui blockchain.
        
        Synthesize findings from all 4 pillars:
        1. Selling Points: {json.dumps(state.selling_points, indent=2)}
        2. Fundamentals: {json.dumps(state.fundamentals, indent=2)}
        3. Technical: {json.dumps(state.technical, indent=2)}
        4. On-Chain: {json.dumps(state.onchain, indent=2)}
        
        Provide:
        - Executive summary (3-4 sentences)
        - Key findings by pillar
        - Risk vs Reward analysis
        - Final recommendation based on research goal: {state.research_goal}
        - Overall confidence score (0-10)
        
        Format in clear Markdown with sections and bullet points.
        """

        try:
            response = await self.llm.ainvoke([SystemMessage(content=system_prompt)])
            state.final_report = response.content

            # Calculate overall confidence
            scores = [
                state.selling_points.get("confidence", 0),
                state.fundamentals.get("risk_score", 0),
                state.technical.get("security_score", 0),
                state.onchain.get("health_score", 0)
            ]
            state.confidence_score = sum(
                scores) / len(scores) if scores else 0.0

            logger.info(
                f"Report generated with confidence: {state.confidence_score}")

        except Exception as e:
            logger.error(f"Report synthesis error: {e}")
            state.final_report = f"Error generating report: {str(e)}"
            state.confidence_score = 0.0

        return state

    async def run(self, query: str, user_id: str) -> AsyncGenerator[Dict[str, Any], None]:
        """Run the research agent and stream results"""

        # Initialize state
        initial_state = ResearchState(
            query=query,
            user_id=user_id,
        )

        try:
            logger.info(f"Starting deep research for query: {query}")

            # Emit agent info
            yield {
                "type": "agent_info",
                "agent": "Sui Deep Research"
            }

            yield {
                "type": "response",
                "content": "🔍 **Starting Deep Research**\n\n"
           }

            # Track if we've received any output
            has_output = False
            current_pillar = None

            # Stream progress through pillars
            async for event in self.graph.astream(initial_state):
                logger.info(f"Graph event keys: {list(event.keys())}")

                # Extract state from event
                for node_name, node_state in event.items():
                    logger.debug(f"Processing node: {node_name}")

                    # Handle parse errors
                    if node_name == "parse_query":
                        if hasattr(node_state, 'project_name') and node_state.project_name:
                            yield {
                                "type": "response",
                                "content": f"📊 Analyzing **{node_state.project_name}**\n"
                            }
                            yield {
                                "type": "response",
                                "content": f"🎯 Goal: {node_state.research_goal}\n\n"
                            }
                            has_output = True

                    # Stream pillar progress
                    if hasattr(node_state, 'current_pillar') and node_state.current_pillar:
                        if node_state.current_pillar != current_pillar:
                            current_pillar = node_state.current_pillar
                            pillar_emoji = {
                                "Selling Points": "💡",
                                "Fundamentals": "🏗️",
                                "Technical": "⚙️",
                                "On-Chain": "⛓️"
                            }.get(current_pillar, "🔍")

                            yield {
                                "type": "response",
                                "content": f"---\n\n## {pillar_emoji} {current_pillar}\n\n"
                            }
                            has_output = True

                    # Stream final report
                    if hasattr(node_state, 'final_report') and node_state.final_report:
                        if not has_output:
                            yield {
                                "type": "response",
                                "content": "📝 **Research Report**\n\n"
                            }

                        # Stream report in chunks for better UX
                        report = node_state.final_report
                        chunk_size = 100  # Characters per chunk

                        for i in range(0, len(report), chunk_size):
                            chunk = report[i:i + chunk_size]
                            yield {
                                "type": "response",
                                "content": chunk
                            }
                            # Small delay for streaming effect
                            await asyncio.sleep(0.03)

                        has_output = True

                        # Add confidence score
                        if hasattr(node_state, 'confidence_score'):
                            yield {
                                "type": "response",
                                "content": f"\n\n---\n\n**Confidence Score:** {node_state.confidence_score:.1f}/10\n"
                            }

            # If no output was generated, something went wrong
            if not has_output:
                logger.error("Research completed but no output was generated")
                yield {
                    "type": "response",
                    "content": "\n\n⚠️ Research completed but no detailed output was generated. This might be due to:\n"
                               "- API rate limits\n"
                               "- Insufficient data availability\n"
                               "- Network issues\n\n"
                               "Please try again or rephrase your query."
                }

            # Emit done
            yield {"type": "done"}

        except Exception as e:
            logger.error(f"Research agent error: {e}", exc_info=True)
            yield {
                "type": "response",
                "content": f"\n\n❌ **Research Error**\n\n"
                f"An error occurred during research: {str(e)}\n\n"
                f"Please try:\n"
                f"- Rephrasing your query\n"
                f"- Being more specific about what you want to research\n"
                f"- Trying again in a moment\n"
            }
            yield {"type": "done"}


# ============================================================================
# MAIN FUNCTIONS FOR BACKWARD COMPATIBILITY
# ============================================================================

async def generate_ai_response_stream(
    query: str,
    context: List[Dict[str, str]],
    user_id: str,
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Generate AI response with streaming support.
    Maintains backward compatibility with existing chat system.
    """

    # Check if this is a research query (contains keywords)
    research_keywords = ["research", "analyze",
                         "evaluate", "investigate", "deep dive", "report on"]
    is_research_query = any(keyword in query.lower()
                            for keyword in research_keywords)

    if is_research_query:
        # Use deep research agent
        agent = SuiResearchAgent()
        async for chunk in agent.run(query, user_id):
            yield chunk
    else:
        # Use simple chat for general queries
        llm = ChatGoogleGenerativeAI(
            model=settings.LLM_MODEL,
            google_api_key=settings.GEMINI_API_KEY,
            temperature=settings.LLM_TEMPERATURE,
            streaming=True
        )

        messages = [
            SystemMessage(
                content="You are Tovira, a helpful Sui blockchain assistant. Provide clear, concise answers about Sui blockchain, DeFi, and crypto."),
            *[HumanMessage(content=msg["content"]) if msg["role"] ==
              "user" else AIMessage(content=msg["content"]) for msg in context],
            HumanMessage(content=query)
        ]

        try:
            yield {"type": "agent_info", "agent": "Tovira Chat"}

            async for chunk in llm.astream(messages):
                if hasattr(chunk, 'content') and chunk.content:
                    yield {
                        "type": "response",
                        "content": chunk.content
                    }

            yield {"type": "done"}

        except Exception as e:
            logger.error(f"Chat error: {e}")
            yield {
                "type": "response",
                "content": f"I encountered an error: {str(e)}. Please try again."
            }
            yield {"type": "done"}


async def generate_chat_name(query: str) -> str:
    """Generate an intelligent chat name from the first message"""
    try:
        llm = ChatGoogleGenerativeAI(
            model=settings.LLM_MODEL,
            google_api_key=settings.GEMINI_API_KEY,
            temperature=0.3
        )

        prompt = f"""Generate a short, descriptive chat title (max 5 words) for this message:
        "{query}"
        
        Return only the title, nothing else."""

        response = await llm.ainvoke([HumanMessage(content=prompt)])
        name = response.content.strip().strip('"\'')

        # Fallback if generation fails
        if len(name) > 50 or not name:
            name = query[:47] + "..." if len(query) > 47 else query

        return name

    except Exception as e:
        logger.error(f"Chat name generation error: {e}")
        return query[:47] + "..." if len(query) > 47 else query
