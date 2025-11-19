# app/tools/web3_tool.py
import asyncio
import json
import logging
import os
from typing import Dict, Any, Optional, List
import httpx
from datetime import datetime

logger = logging.getLogger(__name__)

# API Configuration
BRAVE_API_KEY = os.getenv("BRAVE_SEARCH_API_KEY", "")
BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"

COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3"
DEFILLAMA_BASE_URL = "https://api.llama.fi"
SUI_RPC_URL = "https://fullnode.mainnet.sui.io:443"


class BraveSearchClient:
    """Handles Brave Search API calls"""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.timeout = httpx.Timeout(30.0)

    async def search(
        self,
        query: str,
        count: int = 10,
        freshness: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Search with Brave Search API
        
        Args:
            query: Search query
            count: Number of results (max 20)
            freshness: Optional filter ("pd" for past day, "pw" for past week, "pm" for past month)
        """
        if not self.api_key:
            logger.error("Brave API key not configured")
            return {"success": False, "error": "Brave API key missing"}

        try:
            headers = {
                "Accept": "application/json",
                "X-Subscription-Token": self.api_key
            }

            params = {
                "q": query,
                "count": min(count, 20),
                "safesearch": "moderate",
                "text_decorations": False,
            }

            if freshness:
                params["freshness"] = freshness

            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    BRAVE_SEARCH_URL,
                    headers=headers,
                    params=params
                )

                if response.status_code == 200:
                    data = response.json()
                    results = []

                    for item in data.get("web", {}).get("results", []):
                        results.append({
                            "title": item.get("title"),
                            "url": item.get("url"),
                            "description": item.get("description"),
                            "age": item.get("age")
                        })

                    return {
                        "success": True,
                        "results": results,
                        "query": data.get("query", {}).get("original")
                    }
                else:
                    logger.error(
                        f"Brave Search API error: {response.status_code}")
                    return {"success": False, "error": f"API returned {response.status_code}"}

        except Exception as e:
            logger.exception(f"Brave Search error: {e}")
            return {"success": False, "error": str(e)}


class SuiDataFetcher:
    """Handles Sui-specific data fetching"""

    def __init__(self):
        self.timeout = httpx.Timeout(30.0)
        self.brave = BraveSearchClient(BRAVE_API_KEY)

    async def fetch_sui_price(self) -> Dict[str, Any]:
        """Fetch SUI token price and metrics from CoinGecko"""
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    f"{COINGECKO_BASE_URL}/coins/sui",
                    params={"localization": "false", "tickers": "false"}
                )

                if response.status_code == 200:
                    data = response.json()
                    market_data = data.get("market_data", {})

                    return {
                        "success": True,
                        "data": {
                            "name": "Sui",
                            "symbol": "SUI",
                            "price_usd": market_data.get("current_price", {}).get("usd"),
                            "market_cap": market_data.get("market_cap", {}).get("usd"),
                            "volume_24h": market_data.get("total_volume", {}).get("usd"),
                            "price_change_24h": market_data.get("price_change_percentage_24h"),
                            "price_change_7d": market_data.get("price_change_percentage_7d"),
                            "circulating_supply": market_data.get("circulating_supply"),
                            "total_supply": market_data.get("total_supply"),
                            "ath": market_data.get("ath", {}).get("usd"),
                            "atl": market_data.get("atl", {}).get("usd"),
                        }
                    }
                else:
                    return {"success": False, "error": f"API returned {response.status_code}"}
        except Exception as e:
            logger.exception(f"Error fetching SUI price: {e}")
            return {"success": False, "error": str(e)}

    async def fetch_protocol_tvl(self, protocol: str) -> Dict[str, Any]:
        """Fetch TVL for Sui protocols from DefiLlama"""
        try:
            # First search for the protocol on Sui
            search_result = await self.brave.search(f"{protocol} Sui TVL DefiLlama", count=5)

            async with httpx.AsyncClient(timeout=self.timeout) as client:
                # Get all protocols
                response = await client.get(f"{DEFILLAMA_BASE_URL}/protocols")
                if response.status_code != 200:
                    return {"success": False, "error": "Failed to fetch protocol list"}

                protocols = response.json()
                protocol_lower = protocol.lower()
                protocol_data = None

                # Find matching protocol on Sui chain
                for p in protocols:
                    if "sui" in str(p.get("chains", [])).lower():
                        if protocol_lower in p.get("name", "").lower() or protocol_lower == p.get("slug", ""):
                            protocol_data = p
                            break

                if not protocol_data:
                    return {"success": False, "error": f"Protocol '{protocol}' not found on Sui"}

                # Get detailed data
                slug = protocol_data.get("slug")
                response = await client.get(f"{DEFILLAMA_BASE_URL}/protocol/{slug}")

                if response.status_code == 200:
                    data = response.json()

                    # Get Sui-specific TVL if available
                    chain_tvls = data.get("chainTvls", {})
                    sui_tvl = chain_tvls.get("Sui", {})
                    current_tvl = sui_tvl.get(
                        "tvl", [])[-1] if sui_tvl.get("tvl") else data.get("tvl", 0)

                    return {
                        "success": True,
                        "data": {
                            "name": data.get("name"),
                            "symbol": data.get("symbol"),
                            "tvl": current_tvl,
                            "chains": data.get("chains", []),
                            "category": data.get("category"),
                            "url": data.get("url"),
                            "description": data.get("description"),
                            "twitter": data.get("twitter"),
                        },
                        "web_context": search_result.get("results", [])[:2] if search_result.get("success") else []
                    }
                else:
                    return {"success": False, "error": "Failed to fetch protocol details"}

        except Exception as e:
            logger.exception(f"Error fetching protocol TVL: {e}")
            return {"success": False, "error": str(e)}

    async def search_sui_project(self, query: str) -> Dict[str, Any]:
        """Search for Sui projects using Brave Search"""
        try:
            # Enhance query with Sui context
            enhanced_query = f"{query} Sui blockchain"
            result = await self.brave.search(enhanced_query, count=10)

            if result["success"]:
                return {
                    "success": True,
                    "query": query,
                    "results": result["results"]
                }
            else:
                return result

        except Exception as e:
            logger.exception(f"Error searching Sui project: {e}")
            return {"success": False, "error": str(e)}

    async def get_sui_trending(self) -> Dict[str, Any]:
        """Get trending Sui ecosystem projects"""
        try:
            # Search for recent Sui trends
            result = await self.brave.search(
                "Sui blockchain trending projects DeFi",
                count=10,
                freshness="pw"  # Past week
            )

            if result["success"]:
                return {
                    "success": True,
                    "trending": result["results"]
                }
            else:
                return result

        except Exception as e:
            logger.exception(f"Error fetching Sui trends: {e}")
            return {"success": False, "error": str(e)}


async def sui_web3_tool_async(query: str, context: str = "") -> str:
    """
    Quick Sui data lookup tool.
    Handles: price checks, TVL queries, trending projects, quick searches.
    """
    try:
        fetcher = SuiDataFetcher()
        query_lower = query.lower()

        # SUI PRICE QUERY
        if any(word in query_lower for word in ["sui price", "price of sui", "sui cost", "sui value"]):
            result = await fetcher.fetch_sui_price()

            if result["success"]:
                data = result["data"]
                return f"""### SUI Token Price

**Current Price:** ${data['price_usd']:.4f} USD

**Market Metrics:**
- Market Cap: ${data['market_cap']:,.0f}
- 24h Volume: ${data['volume_24h']:,.0f}
- Circulating Supply: {data['circulating_supply']:,.0f} SUI

**Price Changes:**
- 24h: {data['price_change_24h']:.2f}%
- 7d: {data['price_change_7d']:.2f}%

**All-Time:**
- High: ${data['ath']:.4f}
- Low: ${data['atl']:.4f}

💡 *Sui is a layer-1 blockchain with sub-second finality and parallel execution.*
"""
            else:
                return f"Unable to fetch SUI price: {result['error']}"

        # PROTOCOL TVL QUERY
        elif any(word in query_lower for word in ["tvl", "total value locked"]):
            # Extract protocol name
            protocols = ["navi", "cetus", "scallop",
                         "kriya", "turbos", "bluefin", "aftermath"]
            protocol_found = None

            for protocol in protocols:
                if protocol in query_lower:
                    protocol_found = protocol
                    break

            if protocol_found:
                result = await fetcher.fetch_protocol_tvl(protocol_found)

                if result["success"]:
                    data = result["data"]
                    response = f"""### {data['name']} on Sui

**Total Value Locked (TVL):** ${data['tvl']:,.0f}

**Details:**
- Category: {data['category']}
- Chains: {', '.join(data['chains'])}
- Website: {data['url']}
"""
                    if data.get('description'):
                        response += f"\n{data['description'][:200]}...\n"

                    # Add web context
                    if result.get('web_context'):
                        response += "\n**Recent Information:**\n"
                        for item in result['web_context']:
                            response += f"- {item['title']}: {item['url']}\n"

                    return response
                else:
                    return f"Unable to fetch TVL for {protocol_found}: {result['error']}"
            else:
                return "Please specify a Sui protocol (e.g., 'Navi TVL', 'Cetus TVL')"

        # TRENDING QUERY
        elif any(word in query_lower for word in ["trending", "hot", "popular"]):
            result = await fetcher.get_sui_trending()

            if result["success"]:
                response = "### Trending on Sui Ecosystem\n\n"
                for idx, item in enumerate(result["trending"][:7], 1):
                    response += f"{idx}. **{item['title']}**\n"
                    response += f"   {item['description'][:100]}...\n"
                    response += f"   🔗 {item['url']}\n\n"
                return response
            else:
                return f"Unable to fetch trending Sui projects: {result['error']}"

        # SEARCH QUERY
        elif any(word in query_lower for word in ["search", "find", "look for"]):
            # Extract search term
            search_words = query.split()
            search_term = " ".join([w for w in search_words if w.lower() not in [
                                   "search", "find", "look", "for", "on", "sui"]])

            if not search_term:
                return "What would you like to search for on Sui?"

            result = await fetcher.search_sui_project(search_term)

            if result["success"]:
                response = f"### Search Results: '{search_term}' on Sui\n\n"
                for idx, item in enumerate(result["results"][:5], 1):
                    response += f"{idx}. **{item['title']}**\n"
                    response += f"   {item['description']}\n"
                    response += f"   🔗 {item['url']}\n\n"

                response += "\n💡 *For deep research, ask: 'Analyze [project name]'*"
                return response
            else:
                return f"Search failed: {result['error']}"

        # DEFAULT HELP
        else:
            return """### Sui Quick Data Lookup

I can help you with:

**🪙 Token Price:**
- "What's the SUI price?"
- "SUI value in USD"

**📊 Protocol Metrics:**
- "Navi TVL"
- "Cetus total value locked"
- "Scallop TVL"

**🔥 Trending:**
- "What's trending on Sui?"
- "Popular Sui projects"

**🔍 Search:**
- "Search for [project] on Sui"
- "Find Sui DeFi protocols"

**🔬 Deep Research:**
- "Analyze [project name]" (requires gas fee)

What would you like to know?
"""

    except Exception as e:
        logger.exception(f"Sui web3 tool error: {e}")
        return f"An error occurred: {str(e)}"
