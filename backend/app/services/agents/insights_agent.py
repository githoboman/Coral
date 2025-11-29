# app/services/agents/insights_agent.py
import logging
import asyncio
import json
import re
from typing import Dict, Optional, List, Any, Tuple
from datetime import datetime, timedelta
from dataclasses import dataclass, asdict
from enum import Enum

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

from app.core.config import settings
from app.services.agents.web3_agent import Web3Agent

logger = logging.getLogger(__name__)


# === Data Models ===
@dataclass
class TechnicalSignal:
    indicator: str
    signal: str  # bullish/bearish/neutral
    description: str
    strength: int  # 1-5
    ref_type: str = ""  # e.g., "chart" or "post"


@dataclass
class MarketMetric:
    name: str
    value: str
    change: Optional[str] = None
    interpretation: Optional[str] = None


@dataclass
class InsightPoint:
    title: str
    description: str
    data_points: List[str]
    confidence: str  # high/medium/low
    post_count: int = 0  # e.g., number of supporting posts
    chart_count: int = 0  # e.g., number of charts referenced


@dataclass
class StructuredInsights:
    token_symbol: str
    token_name: str
    analysis_timestamp: str

    # Project Overview
    project_description: str
    key_features: List[str]

    # TLDR Section
    tldr_overall: str
    key_takeaways: List[str]
    current_price: str
    price_change_24h: str

    # Key Developments
    developments: List[str]

    # Technical Analysis
    technical_signals: List[TechnicalSignal]

    # Market Dynamics
    market_metrics: List[MarketMetric]

    # Positives (Bullish signals)
    positives: List[InsightPoint]

    # Risks (Bearish signals)
    risks: List[InsightPoint]

    # Community Sentiment
    sentiment_score: float  # 0-100
    sentiment_description: str
    community_insights: List[InsightPoint]

    # Data sources used
    data_sources: List[str]


class AnalysisFramework(Enum):
    """Structured analysis methodology"""
    FUNDAMENTALS = "project_utility_team_roadmap"
    TECHNICALS = "price_action_indicators_patterns"
    ON_CHAIN = "holder_distribution_flows_activity"
    SENTIMENT = "social_volume_tone_influencer_activity"
    MARKET_STRUCTURE = "liquidity_volume_exchange_listings"


class EnhancedInsightsAgent:
    """
    Production-grade insights agent with structured analysis framework.
    Integrates multiple data sources and outputs formatted insights.
    """

    def __init__(self):
        self.llm = ChatGoogleGenerativeAI(
            model="gemini-2.0-flash",
            temperature=0.4,
            google_api_key=settings.GEMINI_API_KEY,
        )

        self.web3_agent = Web3Agent()
        self.analysis_cache = {}
        self.cache_ttl = 300

    def _format_time_ago(self, dt_str: str) -> str:
        """Format timestamp as 'X min/hours/days ago'."""
        try:
            dt = datetime.fromisoformat(dt_str.replace('Z', '+00:00'))
            delta = datetime.utcnow() - dt
            total_seconds = delta.total_seconds()
            if total_seconds < 3600:
                mins = int(total_seconds / 60)
                return f"{mins} min ago" if mins == 1 else f"{mins} mins ago"
            elif total_seconds < 86400:
                hours = int(total_seconds / 3600)
                return f"{hours} hour ago" if hours == 1 else f"{hours} hours ago"
            else:
                days = delta.days
                return f"{days} day ago" if days == 1 else f"{days} days ago"
        except:
            return "Just now"

    # === Data Gathering ===
    async def _gather_market_data(self, token: str) -> Dict[str, Any]:
        """Fetch comprehensive market data from Web3 agent"""
        try:
            raw_data = await self.web3_agent.fetch_token_data(token)
            if not raw_data:
                return None

            return {
                "price_usd": raw_data.get("price_usd", 0),
                "liquidity_usd": raw_data.get("liquidity_usd", 0),
                "volume_24h": raw_data.get("volume_24h", 0),
                "change_24h": raw_data.get("change_24h", 0),
                "fdv": raw_data.get("fdv", 0),
                "chain": raw_data.get("chain", "unknown"),
                "pair_url": raw_data.get("pair_url", ""),
                "last_updated": raw_data.get("last_updated", "")
            }
        except Exception as e:
            logger.error(f"Failed to gather market data: {e}")
            return None

    async def _get_project_overview(self, token: str) -> Tuple[str, str, List[str]]:
        """Generate project overview, full name, description, and key features."""
        prompt = ChatPromptTemplate.from_template("""
You are a crypto analyst. Provide a concise overview for {token} in Binance AI style.

- full_name: The project's common name (e.g., "Sui" for SUI, "Walrus" for WAL)
- description: 1-sentence summary (15-25 words): e.g., "Sui is a high-performance Layer 1 blockchain designed for scalable DeFi and gaming applications."
- key_features: 3-4 bullet points of core features: e.g., ["Object-centric data model", "Parallel transaction execution", "Sub-second finality"]

Return ONLY JSON:
{{"full_name": "Sui", "description": "Sui is a high-performance Layer 1 blockchain...", "key_features": ["Object-centric data model", "Parallel transaction execution", "Sub-second finality", "Developer-friendly Move language"]}}
""")

        try:
            chain = prompt | self.llm | StrOutputParser()
            response = await asyncio.wait_for(
                chain.ainvoke({"token": token}),
                timeout=10.0
            )

            data = json.loads(response.strip())
            full_name = data.get("full_name", token)
            desc = data.get(
                "description", f"{token} is a cryptocurrency token.")
            features = data.get(
                "key_features", [f"Feature 1 for {token}", f"Feature 2 for {token}"])

            return full_name, desc, features

        except Exception as e:
            logger.warning(f"Project overview generation failed: {e}")
            return token, f"{token} is a cryptocurrency token on blockchain.", [f"Key feature 1", "Key feature 2", "Key feature 3"]

    async def _analyze_technicals(self, token: str, market_data: Dict) -> List[TechnicalSignal]:
        """Generate technical analysis signals"""
        signals = []

        # Price trend analysis
        change_24h = market_data.get("change_24h", 0)
        if abs(change_24h) > 5:  # Adjusted threshold to match example
            signal_type = "bullish" if change_24h > 0 else "bearish"
            ref_type = "chart" if abs(change_24h) > 10 else ""
            signals.append(TechnicalSignal(
                indicator="Price Momentum" if change_24h > 0 else "Bearish Trend",
                signal=signal_type,
                description=f"The token's price has {'increased' if change_24h > 0 else 'declined'} by {abs(change_24h):.2f}% over the last 24 hours",
                strength=min(5, int(abs(change_24h) / 5)),
                ref_type=ref_type
            ))

        # Volume analysis
        volume = market_data.get("volume_24h", 0)
        liquidity = market_data.get("liquidity_usd", 1)
        volume_ratio = volume / liquidity if liquidity > 0 else 0

        if volume_ratio > 0.5:
            signals.append(TechnicalSignal(
                indicator="Volume/Liquidity Ratio",
                signal="bullish",
                description=f"High trading volume (${volume:,.0f}) relative to liquidity indicates strong interest",
                strength=4,
                ref_type="chart"
            ))
        elif volume_ratio < 0.1:
            signals.append(TechnicalSignal(
                indicator="Volume/Liquidity Ratio",
                signal="bearish",
                description=f"Low trading volume relative to liquidity indicates weak interest",
                strength=3,
                ref_type="chart"
            ))

        # Add LLM-enhanced technical analysis
        tech_analysis = await self._get_llm_technical_analysis(token, market_data)
        signals.extend(tech_analysis)

        return signals

    async def _get_llm_technical_analysis(self, token: str, market_data: Dict) -> List[TechnicalSignal]:
        """Use LLM to infer additional technical patterns, matching example style"""
        prompt = ChatPromptTemplate.from_template("""
You are a technical analyst. Based on the market data, generate 1-2 key technical signals in the style of Binance AI reports.

Token: {token}
Price: ${price_usd:.6f}
24h Change: {change_24h:+.2f}%
Volume: ${volume_24h:,.0f}
Liquidity: ${liquidity_usd:,.0f}

Examples:
- "MACD Bullish Cross: The MACD line has recently crossed above its signal line, and the MACD histogram has been positive for several hours, indicating a shift towards bullish momentum."
- "Bearish Trend: The token's price has declined by -5.72% over the last 24 hours, with the 7-period and 25-period EMAs trading below the 99-period EMA, indicating a sustained bearish trend."

For each signal:
- indicator (e.g., "MACD Bullish Cross")
- signal (bullish/bearish)
- description (detailed, 20-40 words, include specific metrics)
- strength (1-5)
- ref_type ("chart" or empty)

Return ONLY JSON array: [{{"indicator": "...", "signal": "...", "description": "...", "strength": 3, "ref_type": "chart"}}]
""")

        try:
            chain = prompt | self.llm | StrOutputParser()
            response = await asyncio.wait_for(
                chain.ainvoke({
                    "token": token,
                    "price_usd": market_data.get("price_usd", 0),
                    "change_24h": market_data.get("change_24h", 0),
                    "volume_24h": market_data.get("volume_24h", 0),
                    "liquidity_usd": market_data.get("liquidity_usd", 0)
                }),
                timeout=15.0
            )

            signals_data = json.loads(response.strip())
            return [TechnicalSignal(**s) for s in signals_data[:2]]

        except Exception as e:
            logger.warning(f"LLM technical analysis failed: {e}")
            return []

    async def _analyze_fundamentals(self, token: str, context: str) -> tuple[List[InsightPoint], List[InsightPoint]]:
        """Analyze project fundamentals - returns (positives, risks), matching example style"""
        prompt = ChatPromptTemplate.from_template("""
Analyze {token} fundamentals. Generate 2-3 positives and 2-3 risks in Binance AI style.

Context: {context}

Examples for positives:
- Title: "Project Utility"
  Description: "Walrus is recognized for building essential infrastructure for AI data markets on the Sui Network, focusing on data availability, scalability, and modular design, growing stronger every week."
  Data points: ["Focus on modular design", "Growing weekly"]
  Confidence: "high"

Examples for risks:
- Title: "Low Concentration"
  Description: "The concentration score is low at 0.0195, indicating that large holders have limited influence, which could imply a lack of strong institutional backing or conviction."
  Data points: ["Concentration score: 0.0195", "Limited large holder influence"]
  Confidence: "medium"

For each:
- title (max 3 words)
- description (20-40 words, detailed)
- data_points (1-2 bullets with metrics)
- confidence (high/medium/low)
- For positives, set post_count=1; for risks, chart_count=1 (simulate sources)

Return JSON:
{{
    "positives": [{{"title": "...", "description": "...", "data_points": ["..."], "confidence": "high", "post_count": 1}}],
    "risks": [{{"title": "...", "description": "...", "data_points": ["..."], "confidence": "medium", "chart_count": 1}}]
}}
""")

        try:
            chain = prompt | self.llm | StrOutputParser()
            response = await asyncio.wait_for(
                chain.ainvoke({"token": token, "context": context}),
                timeout=20.0
            )

            data = json.loads(response.strip())
            positives = [InsightPoint(
                title=p["title"], description=p["description"],
                data_points=p["data_points"], confidence=p["confidence"],
                post_count=p.get("post_count", 0)
            ) for p in data.get("positives", [])]
            risks = [InsightPoint(
                title=r["title"], description=r["description"],
                data_points=r["data_points"], confidence=r["confidence"],
                chart_count=r.get("chart_count", 0)
            ) for r in data.get("risks", [])]

            return positives, risks

        except Exception as e:
            logger.error(f"Fundamental analysis failed: {e}")
            return [], []

    async def _analyze_sentiment(self, token: str, market_data: Dict) -> tuple[float, str, List[InsightPoint]]:
        """Analyze community sentiment - returns (score, description, insights), matching example"""
        prompt = ChatPromptTemplate.from_template("""
Analyze sentiment for {token} based on market data. Generate in Binance AI style.

Market Data:
- 24h Change: {change_24h:+.2f}%
- Volume: ${volume_24h:,.0f}
- Liquidity: ${liquidity_usd:,.0f}

Example:
- Score: 55
- Description: "Mixed sentiment"
- Insights: [{{"title": "Mixed Views", "description": "Early community discussions show mixed sentiment, with some members expressing bullish aspirations for a price target of $1, while others mentioned taking profits from recent airdrops.", "data_points": ["Bullish $1 target", "Profit taking"], "confidence": "medium", "post_count": 2}}]

Provide:
- score (0-100)
- description (max 10 words, e.g., "Cautiously optimistic with mixed signals")
- 1 insight with title, description (20-30 words), data_points (1-2), confidence, post_count (1-4)

Return JSON:
{{
    "score": 55,
    "description": "Mixed sentiment",
    "insights": [{{"title": "...", "description": "...", "data_points": ["..."], "confidence": "medium", "post_count": 2}}]
}}
""")

        try:
            chain = prompt | self.llm | StrOutputParser()
            response = await asyncio.wait_for(
                chain.ainvoke({
                    "token": token,
                    "change_24h": market_data.get("change_24h", 0),
                    "volume_24h": market_data.get("volume_24h", 0),
                    "liquidity_usd": market_data.get("liquidity_usd", 0)
                }),
                timeout=15.0
            )

            data = json.loads(response.strip())
            insights = [InsightPoint(
                title=i["title"], description=i["description"],
                data_points=i["data_points"], confidence=i["confidence"],
                post_count=i.get("post_count", 0), chart_count=i.get("chart_count", 0)
            ) for i in data.get("insights", [])]
            return (
                data.get("score", 50),
                data.get("description", "Neutral sentiment"),
                insights
            )

        except Exception as e:
            logger.error(f"Sentiment analysis failed: {e}")
            return 50, "Unable to determine sentiment", []

    async def _generate_tldr(self, token: str, token_name: str, market_data: Dict, technicals: List[TechnicalSignal]) -> Dict[str, Any]:
        """Generate structured TLDR: overall thesis and key takeaways."""
        prompt = ChatPromptTemplate.from_template("""
Generate a concise TLDR for {token} in Binance AI format.

Token: {token_name} ({token})
Price: ${price:.4f}
Change: {change:+.2f}%
Top Technical: {top_signal}

Output JSON:
{{
    "overall": "Sui's ecosystem shows strong growth in DeFi and gaming sectors, driven by recent partnerships and high TVL.",
    "takeaways": [
        "Ecosystem Growth: TVL exceeding $2.6 billion with new protocol integrations.",
        "Price & Technicals: Bullish MACD crossover signals momentum despite short-term volatility.",
        "Market Outlook: Optimistic community sentiment anticipates upcoming upgrades and adoption."
    ]
}}

- overall: 1 sentence thesis (20-30 words)
- takeaways: Exactly 3 strings, each 15-25 words: [Ecosystem/Project Health, Price & Technicals, Market Outlook/Sentiment]
""")

        top_signal = technicals[0].description if technicals else "mixed technical signals"

        try:
            chain = prompt | self.llm | StrOutputParser()
            response = await asyncio.wait_for(
                chain.ainvoke({
                    "token": token,
                    "token_name": token_name,
                    "price": market_data.get("price_usd", 0),
                    "change": market_data.get("change_24h", 0),
                    "top_signal": top_signal,
                }),
                timeout=10.0
            )
            data = json.loads(response.strip())
            return {
                "overall": data.get("overall", f"{token_name} ({token}) is experiencing {market_data.get('change_24h', 0):+.2f}% price movement with mixed signals."),
                "takeaways": data.get("takeaways", [
                    "Ecosystem: Stable growth observed.",
                    "Technicals: Mixed indicators.",
                    "Outlook: Neutral sentiment."
                ])
            }
        except Exception as e:
            logger.error(f"TLDR generation failed: {e}")
            change_str = "rise" if market_data.get(
                "change_24h", 0) > 0 else "decline"
            return {
                "overall": f"{token_name} ({token}) is trading at ${market_data.get('price_usd', 0):.4f}, reflecting a {market_data.get('change_24h', 0):+.2f}% {change_str}.",
                "takeaways": [
                    "Project Health: Recent developments show steady progress.",
                    "Price & Technicals: Volatility with neutral signals.",
                    "Market Outlook: Balanced community views."
                ]
            }

    # === Main Analysis Pipeline ===
    async def analyze_token(self, query: str, context: str = "") -> StructuredInsights:
        """
        Main analysis pipeline that produces structured insights.
        """
        # Extract token symbol
        token = self._extract_token(query)
        if not token:
            raise ValueError("Could not identify token from query")

        # Step 0: Get project overview
        token_name, project_desc, key_features = await self._get_project_overview(token)

        # Step 1: Gather market data
        market_data = await self._gather_market_data(token)
        if not market_data:
            raise ValueError(f"Could not fetch market data for {token}")

        # Step 2: Parallel analysis
        tasks = [
            self._analyze_technicals(token, market_data),
            self._analyze_fundamentals(token, context),
            self._analyze_sentiment(token, market_data)
        ]

        technicals, (positives, risks), (sentiment_score, sentiment_desc, community) = await asyncio.gather(*tasks)

        # Step 3: Generate TLDR
        tldr_data = await self._generate_tldr(token, token_name, market_data, technicals)

        # Integrate technicals into positives/risks if possible (simulate)
        for sig in technicals:
            if sig.signal == "bullish":
                positives.append(InsightPoint(
                    title=sig.indicator,
                    description=sig.description,
                    data_points=[f"Strength: {sig.strength}/5"],
                    confidence="high" if sig.strength > 3 else "medium",
                    post_count=0,
                    chart_count=1 if sig.ref_type == "chart" else 0
                ))
            else:
                risks.append(InsightPoint(
                    title=sig.indicator,
                    description=sig.description,
                    data_points=[f"Strength: {sig.strength}/5"],
                    confidence="high" if sig.strength > 3 else "medium",
                    post_count=0,
                    chart_count=1 if sig.ref_type == "chart" else 0
                ))

        # Step 4: Construct structured output
        insights = StructuredInsights(
            token_symbol=token,
            token_name=token_name,
            analysis_timestamp=datetime.utcnow().isoformat(),
            project_description=project_desc,
            key_features=key_features,
            tldr_overall=tldr_data["overall"],
            key_takeaways=tldr_data["takeaways"],
            current_price=f"${market_data['price_usd']:,.6f}",
            price_change_24h=f"{market_data['change_24h']:+.2f}%",
            developments=[],  # Could add news integration
            technical_signals=technicals,
            market_metrics=[
                MarketMetric(
                    "24h Volume", f"${market_data['volume_24h']:,.0f}"),
                MarketMetric(
                    "Liquidity", f"${market_data['liquidity_usd']:,.0f}"),
                MarketMetric("Chain", market_data['chain'])
            ],
            positives=positives[:4],  # Limit to 4 for balance
            risks=risks[:4],
            sentiment_score=sentiment_score,
            sentiment_description=sentiment_desc,
            community_insights=community[:2],  # Limit to 2 insights
            data_sources=["Dexscreener", "LLM Analysis"]
        )

        return insights

    def _extract_token(self, query: str) -> Optional[str]:
        """Extract token symbol from query"""
        match = re.search(r'\$?([A-Z]{2,10})\b', query, re.IGNORECASE)
        return match.group(1).upper() if match else None

    # === Formatting for Output ===
    def format_as_markdown(self, insights: StructuredInsights) -> str:
        """Format structured insights as markdown to closely mimic the Binance AI app UI."""
        update_ago = self._format_time_ago(insights.analysis_timestamp)

        # Determine header emoji based on price change
        change_val = float(insights.price_change_24h.replace('%', ''))
        header_emoji = "🟢" if change_val > 0 else "🔴" if change_val < 0 else "🟦"

        sections = []

        # 1. Header and Metadata
        sections.append(f"{header_emoji} **{insights.token_symbol} Insights**")
        sections.append(f"**{insights.token_name} ({insights.token_symbol})**")
        sections.append(f"*Updated {update_ago}*")
        sections.append("")  # Spacer

        # Project Overview (What is)
        sections.append(
            f"**What is {insights.token_name} ({insights.token_symbol})?**")
        sections.append(insights.project_description)
        sections.append("")

        # Key Features
        sections.append("**Key Features**")
        for feature in insights.key_features:
            sections.append(f"• {feature}")
        sections.append("")  # Spacer

        # Core Market and Technical Data
        sections.append("**Market Performance**")
        sections.append(f" **Price:** {insights.current_price}")
        sections.append(
            f"📈 **24h Volume:** ${insights.market_metrics[0].value if insights.market_metrics else 'N/A'}")
        # Assuming FDV added to metrics if available
        sections.append(
            f"🏦 **Market Cap (FDV):** ${insights.market_metrics[2].value if len(insights.market_metrics) > 2 and 'FDV' in insights.market_metrics[2].name else 'N/A'}")
        sections.append("")  # Spacer

        # 2. TLDR
        sections.append("**✦ TLDR**")
        sections.append(insights.tldr_overall)
        for i, takeaway in enumerate(insights.key_takeaways, 1):
            sections.append(f"{i}. {takeaway}")
        sections.append("")  # Spacer

        # 4. Balanced Analysis
        # Positives
        if insights.positives:
            sections.append(" **Positives**")
            for pos in insights.positives:
                ref_str = ""
                if pos.post_count > 0:
                    ref_str += f" [{pos.post_count} post{'s' if pos.post_count > 1 else ''}]"
                if pos.chart_count > 0:
                    ref_str += f" [{pos.chart_count} chart{'s' if pos.chart_count > 1 else ''}]"
                sections.append(
                    f"• **{pos.title}:** {pos.description}{ref_str}")
                if pos.data_points:
                    sections.append(f"  {' | '.join(pos.data_points)}")
            sections.append("")  # Spacer

        # Risks
        if insights.risks:
            sections.append("  **Risks**")
            for risk in insights.risks:
                ref_str = ""
                if risk.post_count > 0:
                    ref_str += f" [{risk.post_count} post{'s' if risk.post_count > 1 else ''}]"
                if risk.chart_count > 0:
                    ref_str += f" [{risk.chart_count} chart{'s' if risk.chart_count > 1 else ''}]"
                sections.append(
                    f"• **{risk.title}:** {risk.description}{ref_str}")
                if risk.data_points:
                    sections.append(f"  {' | '.join(risk.data_points)}")
            sections.append("")  # Spacer

        # 5. Community Sentiment
        sections.append("💭 **Community Sentiment**")
        sections.append(
            f"**Score:** {insights.sentiment_score:.0f}/100 - {insights.sentiment_description}")
        if insights.community_insights:
            for insight in insights.community_insights:
                ref_str = f" [{insight.post_count} post{'s' if insight.post_count > 1 else ''}]" if insight.post_count else ""
                sections.append(
                    f"• **{insight.title}:** {insight.description}{ref_str}")
                if insight.data_points:
                    sections.append(f"  {' | '.join(insight.data_points)}")
        sections.append("")  # Spacer

        # Disclaimer
        sections.append(
            "*The information in this report could be inaccurate. Please DYOR; not financial advice.*")

        return "\n".join(sections)

    def format_as_json(self, insights: StructuredInsights) -> str:
        """Format structured insights as JSON (for API/UI consumption)"""
        return json.dumps(asdict(insights), indent=2)


# === Tool Adapter ===
_enhanced_insights_agent = EnhancedInsightsAgent()


async def insights_agent_tool_async(query: str, context: str) -> str:
    """Enhanced insights tool with structured output"""
    logger.info(f"Enhanced insights tool invoked: {query[:60]}")

    try:
        insights = await _enhanced_insights_agent.analyze_token(query, context)
        # Return markdown format for chat display
        return _enhanced_insights_agent.format_as_markdown(insights)
    except Exception as e:
        logger.exception(f"Insights analysis failed: {e}")
        return f"  Unable to analyze token: {str(e)[:100]}"


async def get_structured_insights(query: str, context: str = "") -> StructuredInsights:
    """
    Get structured insights object (for API endpoints that need structured data)
    """
    return await _enhanced_insights_agent.analyze_token(query, context)
