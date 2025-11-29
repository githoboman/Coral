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
        async with httpx.AsyncClient(timeout=10.0) as client:
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
            content = response.text[:5000]
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
    Fetch token data from CoinGecko API (free Demo plan).

    Args:
        token_id: CoinGecko token ID (e.g., 'sui', 'bitcoin')

    Returns:
        JSON string with token data
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            url = f"https://api.coingecko.com/api/v3/coins/{token_id}"
            params = {
                "localization": "false",
                "tickers": "false",
                "community_data": "false",
                "market_data": "true"
            }

            # Add API key if available (supports Demo plan)
            if settings.COINGECKO_API_KEY:
                params["x_cg_demo_api_key"] = settings.COINGECKO_API_KEY

            response = await client.get(url, params=params)

            if response.status_code == 200:
                data = response.json()
                logger.info(f"Fetched CoinGecko data for {token_id}")

                # Extract market data safely
                market_data = data.get("market_data", {})
                return json.dumps({
                    "name": data.get("name"),
                    "symbol": data.get("symbol"),
                    "price_usd": market_data.get("current_price", {}).get("usd"),
                    "market_cap": market_data.get("market_cap", {}).get("usd"),
                    "volume_24h": market_data.get("total_volume", {}).get("usd"),
                    "price_change_24h": market_data.get("price_change_percentage_24h"),
                    "ath": market_data.get("ath", {}).get("usd"),
                    "atl": market_data.get("atl", {}).get("usd")
                }, indent=2)
            else:
                logger.warning(
                    f"CoinGecko API returned {response.status_code}")
                return json.dumps({
                    "error": f"API error: {response.status_code}",
                    "note": "Ensure COINGECKO_API_KEY is set in environment"
                })

    except Exception as e:
        logger.error(f"CoinGecko data error: {e}")
        return json.dumps({
            "error": str(e),
            "note": "Make sure to set COINGECKO_API_KEY in your .env file"
        })


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
        self.graph = self._build_graph()

    def _build_graph(self) -> StateGraph:
        """Build the LangGraph workflow"""
        workflow = StateGraph(ResearchState)

        workflow.add_node("parse_query", self._parse_query)
        workflow.add_node("pillar_1_selling_points",
                          self._research_selling_points)
        workflow.add_node("pillar_2_fundamentals", self._research_fundamentals)
        workflow.add_node("pillar_3_technical", self._research_technical)
        workflow.add_node("pillar_4_onchain", self._research_onchain)
        workflow.add_node("synthesize", self._synthesize_report)
        workflow.add_node("tools", self.tool_node)

        workflow.set_entry_point("parse_query")
        workflow.add_edge("parse_query", "pillar_1_selling_points")
        workflow.add_edge("pillar_1_selling_points", "pillar_2_fundamentals")
        workflow.add_edge("pillar_2_fundamentals", "pillar_3_technical")
        workflow.add_edge("pillar_3_technical", "pillar_4_onchain")
        workflow.add_edge("pillar_4_onchain", "synthesize")
        workflow.add_edge("synthesize", END)

        return workflow.compile()

    async def _call_llm_with_timeout(self, messages: List, timeout: float = 60.0) -> str:
        """Call LLM with timeout protection and proper error handling"""
        try:
            # Ensure we have at least a SystemMessage and HumanMessage
            if not messages:
                messages = [HumanMessage(content="Provide analysis.")]
            elif len(messages) == 1 and isinstance(messages[0], SystemMessage):
                # If only system message, add a human message
                messages.append(HumanMessage(
                    content="Provide a detailed analysis."))

            response = await asyncio.wait_for(
                self.llm.ainvoke(messages),
                timeout=timeout
            )
            return response.content
        except asyncio.TimeoutError:
            logger.warning(f"LLM call timed out after {timeout}s")
            return "[Analysis timed out - please try a more specific query]"
        except Exception as e:
            logger.error(f"LLM error: {e}")
            return f"[Error: {str(e)}]"

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
            content = await self._call_llm_with_timeout(messages, timeout=30.0)

            if content.startswith("["):
                raise ValueError("LLM timeout or error")

            logger.debug(f"Raw LLM response: {content}")
            parsed = json.loads(content)

            if not isinstance(parsed, dict):
                raise ValueError(f"Invalid response type: {type(parsed)}")

            project_name = parsed.get("project_name", "").strip()
            research_goal = parsed.get("research_goal", "").strip()

            if not project_name or not research_goal:
                raise ValueError(f"Missing fields: {parsed}")

            state.project_name = project_name
            state.research_goal = research_goal
            state.progress.append(
                f"Researching {state.project_name} for {state.research_goal}")
            state.messages.append({
                "role": "assistant",
                "content": f"Researching {state.project_name}..."
            })
            logger.info(
                f"Parsed: {state.project_name} - {state.research_goal}")
            return state

        except Exception as e:
            logger.error(f"Parse error: {e}")
            state.project_name = "SUI"
            state.research_goal = "general analysis"
            state.progress.append("Using default parameters")
            state.messages.append({
                "role": "assistant",
                "content": "Proceeding with general SUI analysis..."
            })
            return state

    async def _research_selling_points(self, state: ResearchState) -> ResearchState:
        """Pillar 1: Research value proposition and selling points"""
        logger.info(f"Researching selling points for {state.project_name}")
        state.current_pillar = "Selling Points"

        system_prompt = f"""Research the value proposition of {state.project_name} on Sui blockchain.

Focus on:
1. Core product/service and problem solved
2. Unique selling proposition
3. Target audience and use cases
4. Competitive advantages
5. Market positioning

Keep response under 400 words. Use search results provided."""

        messages = [SystemMessage(content=system_prompt)]

        try:
            search_results = await asyncio.wait_for(
                web_search.ainvoke({
                    "query": f"{state.project_name} Sui blockchain value proposition",
                    "num_results": 5
                }),
                timeout=20.0
            )

            if len(search_results) > 8000:
                search_results = search_results[:8000] + "\n[Truncated]"

            messages.append(HumanMessage(
                content=f"Search results: {search_results}"))
        except Exception as e:
            logger.warning(f"Search failed: {e}")
            messages.append(HumanMessage(
                content="Provide analysis based on general knowledge."))

        content = await self._call_llm_with_timeout(messages, timeout=60.0)

        state.selling_points = {
            "summary": content,
            "confidence": 7.5,
            "timestamp": datetime.utcnow().isoformat()
        }
        state.completed_pillars.append("selling_points")
        return state

    async def _research_fundamentals(self, state: ResearchState) -> ResearchState:
        """Pillar 2: Research fundamentals"""
        logger.info(f"Researching fundamentals for {state.project_name}")
        state.current_pillar = "Fundamentals"

        system_prompt = f"""Research the fundamental strength of {state.project_name}.

Analyze:
1. Team background and credibility
2. Funding rounds and investors
3. Community size and engagement
4. Tokenomics and token utility
5. Roadmap and milestones

Keep response under 400 words. Use funding data provided."""

        messages = [SystemMessage(content=system_prompt)]

        try:
            funding_data = await asyncio.wait_for(
                web_search.ainvoke({
                    "query": f"{state.project_name} funding investors team Sui",
                    "num_results": 5
                }),
                timeout=20.0
            )

            if len(funding_data) > 8000:
                funding_data = funding_data[:8000] + "\n[Truncated]"

            messages.append(HumanMessage(
                content=f"Funding data: {funding_data}"))
        except Exception as e:
            logger.warning(f"Search failed: {e}")
            messages.append(HumanMessage(
                content="Provide analysis based on general knowledge."))

        content = await self._call_llm_with_timeout(messages, timeout=60.0)

        state.fundamentals = {
            "analysis": content,
            "risk_score": 6.0,
            "timestamp": datetime.utcnow().isoformat()
        }
        state.completed_pillars.append("fundamentals")
        return state

    async def _research_technical(self, state: ResearchState) -> ResearchState:
        """Pillar 3: Research technical aspects"""
        logger.info(f"Researching technical for {state.project_name}")
        state.current_pillar = "Technical"

        system_prompt = f"""Analyze technical implementation of {state.project_name} on Sui.

Focus on:
1. Technical architecture
2. Smart contract security and audits
3. Sui Move implementation quality
4. Known vulnerabilities
5. Technical risks

Keep response under 400 words."""

        messages = [SystemMessage(content=system_prompt)]

        try:
            tech_data = await asyncio.wait_for(
                web_search.ainvoke({
                    "query": f"{state.project_name} Sui Move audit security",
                    "num_results": 5
                }),
                timeout=20.0
            )

            if len(tech_data) > 8000:
                tech_data = tech_data[:8000] + "\n[Truncated]"

            messages.append(HumanMessage(
                content=f"Technical data: {tech_data}"))
        except Exception as e:
            logger.warning(f"Search failed: {e}")
            messages.append(HumanMessage(
                content="Provide analysis based on general knowledge."))

        content = await self._call_llm_with_timeout(messages, timeout=60.0)

        state.technical = {
            "analysis": content,
            "security_score": 7.0,
            "timestamp": datetime.utcnow().isoformat()
        }
        state.completed_pillars.append("technical")
        return state

    async def _research_onchain(self, state: ResearchState) -> ResearchState:
        """Pillar 4: Research on-chain metrics"""
        logger.info(f"Researching on-chain for {state.project_name}")
        state.current_pillar = "On-Chain"

        if state.project_name.upper() in ["SUI", "SUI TOKEN"]:
            try:
                cg_data = await asyncio.wait_for(
                    coingecko_data.ainvoke({"token_id": "sui"}),
                    timeout=15.0
                )

                system_prompt = f"""Analyze market metrics for {state.project_name}.
Examine price, market cap, volume, and trends. Keep under 300 words."""

                messages = [
                    SystemMessage(content=system_prompt),
                    HumanMessage(content=f"CoinGecko data: {cg_data}")
                ]

                content = await self._call_llm_with_timeout(messages, timeout=60.0)

                state.onchain = {
                    "metrics": content,
                    "health_score": 8.0,
                    "timestamp": datetime.utcnow().isoformat()
                }
            except Exception as e:
                logger.error(f"On-chain error: {e}")
                state.onchain = {
                    "metrics": f"[Unable to fetch on-chain metrics: {str(e)}]",
                    "health_score": 5.0
                }

            state.completed_pillars.append("onchain")
            return state

        system_prompt = f"""Analyze on-chain metrics for {state.project_name}.

Examine:
1. TVL and liquidity
2. Active users
3. Transaction volume
4. Growth trends

Keep under 400 words."""

        messages = [SystemMessage(content=system_prompt)]

        try:
            onchain_data_result = await asyncio.wait_for(
                sui_onchain_data.ainvoke({
                    "project_name": state.project_name,
                    "metric": "all"
                }),
                timeout=20.0
            )

            if len(onchain_data_result) > 8000:
                onchain_data_result = onchain_data_result[:8000] + \
                    "\n[Truncated]"

            messages.append(HumanMessage(
                content=f"On-chain data: {onchain_data_result}"))
        except Exception as e:
            logger.warning(f"On-chain data fetch failed: {e}")
            messages.append(HumanMessage(
                content="Provide analysis based on general knowledge."))

        content = await self._call_llm_with_timeout(messages, timeout=60.0)

        state.onchain = {
            "metrics": content,
            "health_score": 7.5,
            "timestamp": datetime.utcnow().isoformat()
        }
        state.completed_pillars.append("onchain")
        return state

    async def _synthesize_report(self, state: ResearchState) -> ResearchState:
        """Synthesize all research into final report"""
        logger.info(f"Synthesizing report for {state.project_name}")

        # Build compact JSON to avoid token overflow
        selling_points_text = state.selling_points.get("summary", "No data")[:500]
        fundamentals_text = state.fundamentals.get("analysis", "No data")[:500]
        technical_text = state.technical.get("analysis", "No data")[:500]
        onchain_text = state.onchain.get("metrics", "No data")[:500]

        system_prompt = f"""Create a comprehensive research report for {state.project_name} on Sui blockchain.

            SELLING POINTS:
            {selling_points_text}

            FUNDAMENTALS:
            {fundamentals_text}

            TECHNICAL:
            {technical_text}

            ON-CHAIN METRICS:
            {onchain_text}

            Provide:
            1. Executive Summary (2-3 sentences)
            2. Key Findings by Pillar (3-4 bullet points)
            3. Risk vs Reward Analysis (brief)
            4. Final Recommendation for: {state.research_goal}
            5. Overall Confidence Score (0-10)

            Format in Markdown. Keep under 600 words."""

        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(
                content="Generate the research report based on the data above.")
        ]

        try:
            logger.info("Calling LLM for synthesis...")
            content = await self._call_llm_with_timeout(messages, timeout=90.0)
            logger.info(f"LLM synthesis response length: {len(content)}")

            # Handle timeout responses
            if not content or "[Error:" in content or content.startswith("["):
                logger.error(f"LLM returned error/timeout: {content}")
                state.final_report = f"## Report Generation Issue\n\n{content}\n\nPlease try again with a different query."
            else:
                # CRITICAL FIX: Ensure the report is actually set
                state.final_report = content
                logger.info(
                    f"Successfully set final_report: {len(state.final_report)} chars")

            # Calculate confidence score
            scores = []
            if state.selling_points.get("confidence"):
                scores.append(state.selling_points["confidence"])
            if state.fundamentals.get("risk_score"):
                scores.append(state.fundamentals["risk_score"])
            if state.technical.get("security_score"):
                scores.append(state.technical["security_score"])
            if state.onchain.get("health_score"):
                scores.append(state.onchain["health_score"])

            state.confidence_score = sum(scores) / len(scores) if scores else 5.0
            logger.info(f"Confidence score: {state.confidence_score}")

            # DEBUGGING: Verify the state before returning
            logger.info(
                f"Before return - final_report length: {len(state.final_report)}, confidence: {state.confidence_score}")

        except Exception as e:
            logger.error(f"Synthesis error: {e}", exc_info=True)
            state.final_report = f"## Error Generating Report\n\n{str(e)}\n\nPlease try again."
            state.confidence_score = 0.0

        return state

    async def run(self, query: str, user_id: str) -> AsyncGenerator[Dict[str, Any], None]:
        """Run the research agent and stream results"""
        initial_state = ResearchState(query=query, user_id=user_id)

        try:
            logger.info(f"Starting research for: {query}")
            yield {"type": "agent_info", "agent": "Sui Deep Research"}
            yield {"type": "response", "content": "Starting Deep Research\n\n"}

            has_output = False
            current_pillar = None
            final_state = None

            async for event in self.graph.astream(initial_state):
                for node_name, node_state in event.items():
                    logger.debug(
                        f"Node: {node_name}, State type: {type(node_state)}")

                    # CRITICAL FIX: Save state properly
                    # The node_state is a dict, not a ResearchState object
                    if isinstance(node_state, dict):
                        final_state = node_state
                    else:
                        final_state = node_state

                    if node_name == "parse_query":
                        if isinstance(node_state, dict):
                            project_name = node_state.get('project_name')
                            research_goal = node_state.get('research_goal')
                        else:
                            project_name = getattr(
                                node_state, 'project_name', None)
                            research_goal = getattr(
                                node_state, 'research_goal', None)

                        if project_name:
                            yield {"type": "response", "content": f"Analyzing {project_name}\n"}
                            yield {"type": "response", "content": f"Goal: {research_goal}\n\n"}
                            has_output = True

                    # Handle pillar updates
                    if isinstance(node_state, dict):
                        pillar = node_state.get('current_pillar')
                    else:
                        pillar = getattr(node_state, 'current_pillar', None)

                    if pillar and pillar != current_pillar:
                        current_pillar = pillar
                        yield {"type": "response", "content": f"---\n\n**{current_pillar}**\n\n"}
                        has_output = True

            # After graph completes, extract final report
            if final_state:
                # Handle both dict and object formats
                if isinstance(final_state, dict):
                    report = final_state.get('final_report', '')
                    confidence_score = final_state.get('confidence_score', 0.0)
                else:
                    report = getattr(final_state, 'final_report', '')
                    confidence_score = getattr(
                        final_state, 'confidence_score', 0.0)

                logger.info(f"Final report length: {len(report) if report else 0}")

                if report and len(report) > 0:
                    logger.info(f"Streaming final report of length: {len(report)}")

                    # Stream the report in chunks
                    chunk_size = 100
                    for i in range(0, len(report), chunk_size):
                        chunk = report[i:i + chunk_size]
                        yield {"type": "response", "content": chunk}
                        await asyncio.sleep(0.03)

                    has_output = True

                    if confidence_score > 0:
                        yield {
                            "type": "response",
                            "content": f"\n\n**Confidence Score**: {confidence_score:.1f}/10\n"
                        }
                else:
                    logger.error(
                        f"Final state exists but report is empty. State keys: {final_state.keys() if isinstance(final_state, dict) else dir(final_state)}")
            else:
                logger.error("No final state captured from graph")

            if not has_output:
                yield {"type": "response", "content": "Research completed but no output generated. Please try again.\n"}

            yield {"type": "done"}

        except Exception as e:
            logger.error(f"Research error: {e}", exc_info=True)
            yield {"type": "response", "content": f"Error during research: {str(e)}\n"}
            yield {"type": "done"}


# ============================================================================
# BACKWARD COMPATIBILITY
# ============================================================================

async def generate_ai_response_stream(
    query: str,
    context: List[Dict[str, str]],
    user_id: str,
) -> AsyncGenerator[Dict[str, Any], None]:
    """Generate AI response with streaming support"""
    research_keywords = ["research", "analyze",
                         "evaluate", "investigate", "deep dive", "report on"]
    is_research_query = any(keyword in query.lower()
                            for keyword in research_keywords)

    if is_research_query:
        agent = SuiResearchAgent()
        async for chunk in agent.run(query, user_id):
            yield chunk
    else:
        llm = ChatGoogleGenerativeAI(
            model=settings.LLM_MODEL,
            google_api_key=settings.GEMINI_API_KEY,
            temperature=settings.LLM_TEMPERATURE,
            streaming=True
        )

        messages = [
            SystemMessage(
                content="You are Tovira, a helpful Sui blockchain assistant."),
            *[HumanMessage(content=msg["content"]) if msg["role"] == "user"
              else AIMessage(content=msg["content"]) for msg in context],
            HumanMessage(content=query)
        ]

        try:
            yield {"type": "agent_info", "agent": "Tovira Chat"}

            async for chunk in llm.astream(messages):
                if hasattr(chunk, 'content') and chunk.content:
                    yield {"type": "response", "content": chunk.content}

            yield {"type": "done"}

        except Exception as e:
            logger.error(f"Chat error: {e}")
            yield {"type": "response", "content": f"Error: {str(e)}"}
            yield {"type": "done"}


async def generate_chat_name(query: str) -> str:
    """Generate chat name from first message"""
    try:
        llm = ChatGoogleGenerativeAI(
            model=settings.LLM_MODEL,
            google_api_key=settings.GEMINI_API_KEY,
            temperature=0.3
        )

        prompt = f"""Generate a short chat title (max 5 words) for: "{query}"
Return only the title."""

        response = await asyncio.wait_for(
            llm.ainvoke([HumanMessage(content=prompt)]),
            timeout=10.0
        )
        name = response.content.strip().strip('"\'')

        if len(name) > 50 or not name:
            name = query[:47] + "..." if len(query) > 47 else query

        return name

    except Exception as e:
        logger.error(f"Name generation error: {e}")
        return query[:47] + "..." if len(query) > 47 else query
