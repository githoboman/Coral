# app/tools/insights_tool.py
import asyncio
import json
import logging
import os
from typing import Dict, Any, List, Optional, AsyncGenerator
import httpx
from datetime import datetime
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_google_genai import ChatGoogleGenerativeAI
from serpapi import GoogleSearch

logger = logging.getLogger(__name__)

# API Configuration
SERPAPI_KEY = os.getenv("SERPAPI_KEY", "")
GEMINI_API_KEY = os.getenv("GOOGLE_API_KEY", "")


class GeminiLLMFactory:
    """Factory for creating Gemini LLM instances"""

    @staticmethod
    async def get_llm(temperature: float = 0.7, model: str = "gemini-1.5-flash"):
        """Get Gemini LLM instance"""
        return ChatGoogleGenerativeAI(
            model=model,
            google_api_key=GOOGLE_API_KEY,
            temperature=temperature,
            convert_system_message_to_human=True
        )


class SerpAPIClient:
    """Handles SerpAPI calls for web search"""

    def __init__(self, api_key: str):
        self.api_key = api_key

    def search(
        self,
        query: str,
        num_results: int = 10,
        **kwargs
    ) -> Dict[str, Any]:
        """Execute SerpAPI search"""
        if not self.api_key:
            logger.error("SerpAPI key not configured")
            return {"success": False, "error": "SerpAPI key missing"}

        try:
            params = {
                "q": query,
                "api_key": self.api_key,
                "num": min(num_results, 20),
                "engine": "google",
                **kwargs
            }

            search = GoogleSearch(params)
            results_dict = search.get_dict()

            if "error" in results_dict:
                return {"success": False, "error": results_dict["error"]}

            organic_results = results_dict.get("organic_results", [])

            results = []
            for item in organic_results:
                results.append({
                    "title": item.get("title"),
                    "url": item.get("link"),
                    "description": item.get("snippet"),
                    "date": item.get("date")
                })

            return {
                "success": True,
                "results": results,
                "query": query
            }

        except Exception as e:
            logger.exception(f"SerpAPI error: {e}")
            return {"success": False, "error": str(e)}


class SuiResearchAgent:
    """
    Implements the 4-pillar Sui research framework:
    1. Selling Points (Value Proposition)
    2. Fundamentals (Team, Funding, Community)
    3. Technical (Architecture, Security, Move)
    4. Onchain (Metrics, Activity, TVL)
    """

    def __init__(self):
        self.serp = SerpAPIClient(SERPAPI_KEY)
        self.timeout = httpx.Timeout(60.0)

    async def initialize_research(self, project: str, goal: str = "investment evaluation") -> Dict[str, Any]:
        """
        Step 1: Initialize research with validation
        Returns research plan and validates project exists
        """
        try:
            logger.info(f"Initializing research for: {project}")

            # Quick validation search
            validation = self.serp.search(
                f"{project} official Sui blockchain site:sui.io OR mystenlabs.com",
                num_results=3
            )

            if not validation.get("success"):
                return {
                    "success": False,
                    "error": "Unable to validate project. Please check the name."
                }

            # Check for red flags
            red_flag_search = self.serp.search(
                f"{project} Sui scam OR rug pull OR exploit",
                num_results=5,
                tbs="qdr:m"  # Past month
            )

            red_flags = []
            if red_flag_search.get("success"):
                negative_keywords = ["scam", "rug",
                                     "exploit", "hack", "stolen"]
                for result in red_flag_search.get("results", [])[:3]:
                    title_lower = result.get("title", "").lower()
                    desc_lower = result.get("description", "").lower()
                    if any(kw in title_lower or kw in desc_lower for kw in negative_keywords):
                        red_flags.append(result.get("title"))

            plan = {
                "project": project,
                "goal": goal,
                "start_time": datetime.utcnow().isoformat(),
                "pillars": [
                    "Pillar 1: Selling Points (Value Proposition)",
                    "Pillar 2: Fundamentals (Team & Economics)",
                    "Pillar 3: Technical (Move & Security)",
                    "Pillar 4: Onchain (Metrics & Activity)"
                ],
                "estimated_time": "10-15 minutes",
                "validation_results": validation.get("results", [])[:2],
                "red_flags": red_flags,
                "status": "initialized"
            }

            return {"success": True, "plan": plan}

        except Exception as e:
            logger.exception(f"Initialization error: {e}")
            return {"success": False, "error": str(e)}

    async def research_pillar_1_selling_points(self, project: str) -> Dict[str, Any]:
        """
        Pillar 1: Understand value proposition and market fit
        Focus on Sui-specific advantages (parallel execution, Move, sub-second finality)
        """
        try:
            logger.info(f"[Pillar 1] Researching selling points for {project}")

            # Execute searches synchronously (SerpAPI is sync)
            searches = [
                self.serp.search(
                    f"{project} Sui whitepaper documentation", num_results=5),
                self.serp.search(
                    f"{project} Sui use case problem solved", num_results=5),
                self.serp.search(
                    f"{project} vs competitors Sui Aptos Solana", num_results=5)
            ]

            # Compile search results
            all_results = []
            for search in searches:
                if search.get("success"):
                    all_results.extend(search.get("results", []))

            # Build context for LLM analysis
            context = "\n\n".join([
                f"Source: {r['title']}\n{r['description']}\nURL: {r['url']}"
                for r in all_results[:10]
            ])

            # LLM Analysis with Gemini
            llm = await GeminiLLMFactory.get_llm(temperature=0.3)
            prompt = ChatPromptTemplate.from_messages([
                ("system", """You are a Sui blockchain analyst. Analyze the project's value proposition.

Focus on:
1. Core product/service and problem solved (in Sui context)
2. Unique selling points leveraging Sui's features (Move, parallel execution, zkLogin, etc.)
3. Target audience and use cases
4. Competitive advantages over Aptos, Solana, Ethereum L2s
5. Market positioning in Sui ecosystem

Be specific about Sui integration. Identify if it uses:
- Sui Move objects
- Parallel transaction execution
- zkLogin for onboarding
- Sui consensus (Mysticeti)

Provide structured analysis with confidence score (1-10)."""),
                ("human", """Project: {project}

Web Research:
{context}

Analyze the value proposition and Sui-specific advantages.""")
            ])

            chain = prompt | llm | StrOutputParser()
            analysis = await chain.ainvoke({"project": project, "context": context})

            return {
                "success": True,
                "pillar": "Selling Points",
                "confidence_score": 7,
                "data": {
                    "analysis": analysis,
                    "sources": all_results[:5],
                    "key_questions_answered": [
                        "What problem does it solve?",
                        "Why build on Sui?",
                        "Who is the target user?"
                    ]
                }
            }

        except Exception as e:
            logger.exception(f"Pillar 1 error: {e}")
            return {"success": False, "pillar": "Selling Points", "error": str(e)}

    async def research_pillar_2_fundamentals(self, project: str) -> Dict[str, Any]:
        """
        Pillar 2: Assess team, funding, and sustainability
        Focus on Mysten Labs ties, Sui Foundation grants
        """
        try:
            logger.info(f"[Pillar 2] Researching fundamentals for {project}")

            # Multi-angle searches
            searches = [
                self.serp.search(
                    f"{project} Sui team founders LinkedIn", num_results=5),
                self.serp.search(
                    f"{project} funding round investors Sui Foundation grant", num_results=5),
                self.serp.search(
                    f"{project} Sui tokenomics supply distribution", num_results=5),
                self.serp.search(
                    f"{project} Sui community Twitter Discord growth", num_results=5)
            ]

            all_results = []
            for search in searches:
                if search.get("success"):
                    all_results.extend(search.get("results", []))

            context = "\n\n".join([
                f"Source: {r['title']}\n{r['description']}\nURL: {r['url']}"
                for r in all_results[:12]
            ])

            llm = await GeminiLLMFactory.get_llm(temperature=0.3)
            prompt = ChatPromptTemplate.from_messages([
                ("system", """You are a Sui due diligence analyst. Analyze fundamentals.

Assess:
1. Team composition and experience (Move/Sui background?)
2. Funding sources (VCs, Sui Foundation grants, token sales)
3. Community engagement (Twitter, Discord, Sui forums)
4. Tokenomics (supply, vesting, staking, utility in Sui ecosystem)
5. Roadmap execution (post-Mysticeti upgrades?)
6. Governance model (DAO on Sui?)

Red Flags:
- Anonymous team without track record
- Unsustainable tokenomics (>80% team allocation)
- Ghost town community
- Missed milestones

Trust Signals:
- Mysten Labs partnership
- Sui Foundation backing
- Active Move development
- Strong Sui community presence

Provide balanced assessment with confidence score (1-10)."""),
                ("human", """Project: {project}

Web Research:
{context}

Analyze fundamentals and identify risks/strengths.""")
            ])

            chain = prompt | llm | StrOutputParser()
            analysis = await chain.ainvoke({"project": project, "context": context})

            return {
                "success": True,
                "pillar": "Fundamentals",
                "confidence_score": 6,
                "data": {
                    "analysis": analysis,
                    "sources": all_results[:5],
                    "risk_categories": [
                        "Team verification",
                        "Funding sustainability",
                        "Community health",
                        "Tokenomics design"
                    ]
                }
            }

        except Exception as e:
            logger.exception(f"Pillar 2 error: {e}")
            return {"success": False, "pillar": "Fundamentals", "error": str(e)}

    async def research_pillar_3_technical(self, project: str) -> Dict[str, Any]:
        """
        Pillar 3: Evaluate architecture and security
        Focus on Move code, audits, Sui-specific security
        """
        try:
            logger.info(f"[Pillar 3] Researching technical for {project}")

            searches = [
                self.serp.search(
                    f"{project} Sui Move smart contract GitHub", num_results=5),
                self.serp.search(
                    f"{project} Sui security audit report", num_results=5),
                self.serp.search(
                    f"{project} Sui exploit vulnerability hack", num_results=5),
                self.serp.search(
                    f"{project} Sui architecture Move objects", num_results=5)
            ]

            all_results = []
            for search in searches:
                if search.get("success"):
                    all_results.extend(search.get("results", []))

            context = "\n\n".join([
                f"Source: {r['title']}\n{r['description']}\nURL: {r['url']}"
                for r in all_results[:12]
            ])

            llm = await GeminiLLMFactory.get_llm(temperature=0.3)
            prompt = ChatPromptTemplate.from_messages([
                ("system", """You are a Sui security & architecture analyst.

Evaluate:
1. Technology stack (Move version, Sui SDK, oracles)
2. Smart contract audits (MoveBit, OtterSec, Zellic?)
3. Known vulnerabilities or exploits
4. Code quality (GitHub activity, Move best practices)
5. Sui-specific risks:
   - Shared object contention
   - Object ownership bugs
   - Validator centralization
6. Scalability leveraging Sui's parallel execution

Technical Risks:
- No Move audits
- Exploit history
- Centralized dependencies
- Poor code documentation

Innovations:
- Novel use of Sui objects
- Efficient parallel tx design
- zkLogin integration

Provide technical assessment with confidence score (1-10)."""),
                ("human", """Project: {project}

Web Research:
{context}

Analyze technical architecture and security.""")
            ])

            chain = prompt | llm | StrOutputParser()
            analysis = await chain.ainvoke({"project": project, "context": context})

            return {
                "success": True,
                "pillar": "Technical",
                "confidence_score": 6,
                "data": {
                    "analysis": analysis,
                    "sources": all_results[:5],
                    "security_checklist": [
                        "Move audit status",
                        "Exploit history",
                        "Code quality",
                        "Sui best practices"
                    ]
                }
            }

        except Exception as e:
            logger.exception(f"Pillar 3 error: {e}")
            return {"success": False, "pillar": "Technical", "error": str(e)}

    async def research_pillar_4_onchain(self, project: str) -> Dict[str, Any]:
        """
        Pillar 4: Validate traction with onchain metrics
        Focus on Sui-specific data (epochs, object txs, Suivision)
        """
        try:
            logger.info(f"[Pillar 4] Researching onchain for {project}")

            searches = [
                self.serp.search(
                    f"{project} Sui TVL Suivision dashboard", num_results=5),
                self.serp.search(
                    f"{project} Sui active users transactions volume", num_results=5),
                self.serp.search(
                    f"{project} Sui token holder distribution whale", num_results=5),
                self.serp.search(
                    f"{project} Sui network activity growth", num_results=5)
            ]

            all_results = []
            for search in searches:
                if search.get("success"):
                    all_results.extend(search.get("results", []))

            context = "\n\n".join([
                f"Source: {r['title']}\n{r['description']}\nURL: {r['url']}"
                for r in all_results[:12]
            ])

            llm = await GeminiLLMFactory.get_llm(temperature=0.3)
            prompt = ChatPromptTemplate.from_messages([
                ("system", """You are a Sui onchain data analyst.

Analyze quantifiable metrics:
1. Total Value Locked (TVL) trends on Sui
2. Active users and wallet growth (daily/weekly)
3. Transaction volume and frequency
4. Token holder distribution (whale concentration)
5. Liquidity depth on Sui DEXs (Cetus, Turbos)
6. Network effects and adoption velocity
7. Sui epoch activity

Growth Indicators:
- Rising TVL with sticky users
- Increasing unique wallets
- Diversified holder base
- High tx throughput (Sui advantage)

Red Flags:
- Declining TVL
- Bot-driven activity
- Whale manipulation (>50% by top 10)
- Low liquidity

Provide data-driven assessment with confidence score (1-10)."""),
                ("human", """Project: {project}

Web Research:
{context}

Analyze onchain metrics and traction.""")
            ])

            chain = prompt | llm | StrOutputParser()
            analysis = await chain.ainvoke({"project": project, "context": context})

            return {
                "success": True,
                "pillar": "Onchain",
                "confidence_score": 6,
                "data": {
                    "analysis": analysis,
                    "sources": all_results[:5],
                    "metrics_checked": [
                        "TVL trends",
                        "User growth",
                        "Transaction activity",
                        "Holder distribution"
                    ]
                }
            }

        except Exception as e:
            logger.exception(f"Pillar 4 error: {e}")
            return {"success": False, "pillar": "Onchain", "error": str(e)}

    async def synthesize_research(
        self,
        project: str,
        goal: str,
        pillar_results: List[Dict[str, Any]]
    ) -> str:
        """
        Step 6: Synthesize all pillars into final recommendation
        """
        try:
            logger.info(f"Synthesizing research for {project}")

            # Prepare pillar summaries
            summaries = []
            avg_confidence = 0
            successful_pillars = 0

            for result in pillar_results:
                if result.get("success"):
                    successful_pillars += 1
                    pillar_name = result.get("pillar", "Unknown")
                    confidence = result.get("confidence_score", 0)
                    avg_confidence += confidence
                    analysis = result.get("data", {}).get(
                        "analysis", "No data")

                    summaries.append(
                        f"## {pillar_name} (Confidence: {confidence}/10)\n\n{analysis}\n"
                    )

            if successful_pillars > 0:
                avg_confidence = round(avg_confidence / successful_pillars, 1)

            combined_summaries = "\n\n---\n\n".join(summaries)

            # LLM Synthesis with Gemini
            llm = await GeminiLLMFactory.get_llm(temperature=0.4)
            prompt = ChatPromptTemplate.from_messages([
                ("system", """You are a senior Sui blockchain investment analyst. Synthesize research into actionable insights.

Provide:
1. **Executive Summary** (2-3 sentences capturing essence)
2. **Investment Thesis** (Bullish/Neutral/Bearish with reasoning)
3. **Top 3 Strengths** (Sui-specific advantages)
4. **Top 3 Risks** (Concrete concerns)
5. **Recommendation** (Buy/Hold/Avoid with rationale)
6. **Confidence Level** (1-10 based on data completeness)

Consider:
- Goal: {goal}
- Sui ecosystem context (post-Mysticeti upgrades, 120k TPS potential)
- Current crypto market cycle
- Data gaps (acknowledge limitations)

Be balanced, cite specific findings, avoid hype. Format in Markdown."""),
                ("human", """Project: {project}
Research Goal: {goal}
Average Pillar Confidence: {avg_confidence}/10

---

{summaries}

---

Provide comprehensive synthesis and recommendation.""")
            ])

            chain = prompt | llm | StrOutputParser()
            synthesis = await chain.ainvoke({
                "project": project,
                "goal": goal,
                "avg_confidence": avg_confidence,
                "summaries": combined_summaries
            })

            # Build final report
            report = f"""#  Sui Research Report: {project}

**Research Goal:** {goal}
**Date:** {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}
**Overall Confidence:** {avg_confidence}/10

---

{synthesis}

---

# Detailed Pillar Analysis

{combined_summaries}

---

## Research Methodology

This analysis used the **4-Pillar Sui Research Framework**:

1. **Selling Points:** Value proposition & Sui integration
2. **Fundamentals:** Team, funding, community, tokenomics
3. **Technical:** Move architecture, audits, security
4. **Onchain:** TVL, users, transactions, holder distribution

**Data Sources:** SerpAPI (Google Search), official docs, Sui ecosystem tools

**Limitations:** 
- Web search may miss private information
- Onchain data requires direct Sui RPC for precision
- Market conditions change rapidly

---

## Disclaimer

  **This is an AI-generated analysis for informational purposes only.**

- Not financial advice
- Always DYOR (Do Your Own Research)
- Consult with financial advisors before investing
- Crypto investments carry high risk

---

*Generated by Tovira AI Research Agent powered by Google Gemini*
"""

            return report

        except Exception as e:
            logger.exception(f"Synthesis error: {e}")
            return f"# Research Synthesis Error\n\nUnable to complete synthesis: {str(e)}"


async def sui_insights_tool_async(query: str, context: str = "", extra_data: Dict[str, Any] = None) -> AsyncGenerator[str, None]:
    """
    Main insights tool implementing 4-pillar Sui research.
    Streams progress updates to frontend.
    """
    try:
        query_lower = query.lower()

        # Extract project name
        project_name = None

        # Pattern matching
        if "analyze" in query_lower or "research" in query_lower:
            words = query.split()
            for i, word in enumerate(words):
                if word.lower() in ["analyze", "research", "investigate", "study"]:
                    if i + 1 < len(words):
                        project_name = " ".join(words[i+1:i+3]).strip()
                        break

        # "on Sui" pattern
        if "on sui" in query_lower:
            project_name = query_lower.split("on sui")[0].strip().split()[-1]

        # Known Sui protocols
        sui_protocols = [
            "navi", "cetus", "scallop", "kriya", "turbos", "bluefin",
            "aftermath", "bucket", "movex", "suiswap"
        ]
        for protocol in sui_protocols:
            if protocol in query_lower:
                project_name = protocol
                break

        if not project_name or len(project_name) < 2:
            help_text = """#  Sui Deep Research Agent

I conduct comprehensive 4-pillar analysis of Sui blockchain projects!

## What I Analyze:

** Pillar 1: Selling Points**
- Value proposition & market fit
- Sui-specific advantages (Move, parallel execution)
- Competitive positioning

** Pillar 2: Fundamentals**
- Team & backers (Mysten Labs ties?)
- Funding & Sui Foundation grants
- Tokenomics & community

** Pillar 3: Technical**
- Move smart contract quality
- Security audits & exploits
- Architecture & scalability

** Pillar 4: Onchain**
- TVL trends on Sui
- User growth & activity
- Token distribution

## How to Use:

```
Analyze [Project Name]
Research [Protocol] on Sui
Investigate [Token] fundamentals
```

**Examples:**
- "Analyze Navi Protocol"
- "Research Cetus security"
- "Investigate Scallop lending"

**Time:** 10-15 minutes | **Cost:** 0.01 SUI gas fee

What Sui project would you like me to research?
"""
            yield help_text
            return

        # Initialize agent
        agent = SuiResearchAgent()

        # Determine research goal
        goal = "investment evaluation"
        if "security" in query_lower or "risk" in query_lower:
            goal = "security and risk assessment"
        elif "compare" in query_lower or "vs" in query_lower:
            goal = "competitive analysis"

        # Stream initialization
        yield f"#  Initializing Sui Research: {project_name.title()}\n\n"
        yield f"**Goal:** {goal}\n"
        yield f"**Framework:** 4-Pillar Analysis\n"
        yield f"**Estimated Time:** 10-15 minutes\n\n"
        yield "---\n\n"

        # Step 1: Initialize
        init_result = await agent.initialize_research(project_name, goal)

        if not init_result["success"]:
            yield f" **Initialization Failed:** {init_result['error']}\n\n"
            yield "Please check the project name and try again."
            return

        plan = init_result["plan"]

        yield "##  Research Initialized\n\n"

        if plan.get("red_flags"):
            yield "  **Red Flags Detected:**\n"
            for flag in plan["red_flags"][:3]:
                yield f"- {flag}\n"
            yield "\n"

        yield "##  Executing 4-Pillar Analysis\n\n"

        # Execute all pillars concurrently
        yield " *Running parallel research across all pillars...*\n\n"

        pillar_tasks = [
            agent.research_pillar_1_selling_points(project_name),
            agent.research_pillar_2_fundamentals(project_name),
            agent.research_pillar_3_technical(project_name),
            agent.research_pillar_4_onchain(project_name)
        ]

        pillar_results = await asyncio.gather(*pillar_tasks, return_exceptions=True)

        # Process results
        processed_results = []
        for i, result in enumerate(pillar_results):
            pillar_num = i + 1
            if isinstance(result, Exception):
                logger.error(f"Pillar {pillar_num} failed: {result}")
                yield f" Pillar {pillar_num} encountered an error\n"
                processed_results.append(
                    {"success": False, "error": str(result)})
            else:
                if result.get("success"):
                    yield f" Pillar {pillar_num}: {result.get('pillar')} - Score {result.get('confidence_score')}/10\n"
                else:
                    yield f"  Pillar {pillar_num}: Partial data\n"
                processed_results.append(result)

        yield "\n---\n\n"
        yield "##  Synthesizing Findings...\n\n"

        # Step 6: Synthesize
        final_report = await agent.synthesize_research(project_name, goal, processed_results)

        yield final_report

    except Exception as e:
        logger.exception(f"Insights tool error: {e}")
        error_msg = f"""#  Research Error

An error occurred during the research process:

```
{str(e)}
```

## How to Retry:

1. Check the project name is correct
2. Ensure it's a Sui ecosystem project
3. Try again in a few moments

**Example:** "Analyze Navi Protocol"
"""
        yield error_msg
