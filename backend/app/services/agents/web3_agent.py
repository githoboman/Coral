# web3_agent.py
import requests
from datetime import datetime


class Web3Agent:
    """
    Web3 Intelligence Agent:
    - Searches live data about Web3 protocols, tokens, and tools.
    - Fetches summaries, TVL, price, category, and ecosystem.
    - Designed for integration with Tovira's Base Agent.
    """

    def __init__(self):
        self.coingecko_url = "https://api.coingecko.com/api/v3"
        self.defillama_url = "https://api.llama.fi/protocol/"
        self.default_sources = ["CoinGecko", "DefiLlama", "GitHub"]

    # ---- Public API ----
    def get_project_info(self, query: str) -> dict:
        """
        Search and summarize a Web3 project (token, dApp, or protocol).
        """
        query = query.strip().lower()
        data = {
            "project": query,
            "timestamp": datetime.utcnow().isoformat(),
            "sources_used": [],
            "summary": "",
        }

        # Try DefiLlama
        llama_data = self._search_defillama(query)
        if llama_data:
            data["sources_used"].append("DefiLlama")
            data.update(llama_data)

        # Try CoinGecko
        cg_data = self._search_coingecko(query)
        if cg_data:
            data["sources_used"].append("CoinGecko")
            data.update(cg_data)

        # If nothing found
        if not llama_data and not cg_data:
            data["summary"] = (
                f"No live data found for '{query}'. It may be a newer or smaller Web3 tool."
            )
            return data

        # Build summary
        data["summary"] = self._summarize(data)
        return data

    # ---- Compatibility Wrapper ----
    def run(self, query: str):
        """
        Wrapper method for compatibility with coordinator.
        Allows this agent to be called like web3.run(query)
        """
        return self.get_project_info(query)

    # ---- Internal helpers ----
    def _search_coingecko(self, query: str):
        try:
            res = requests.get(f"{self.coingecko_url}/search?query={query}")
            res.raise_for_status()
            results = res.json().get("coins", [])
            if not results:
                return None

            top = results[0]
            coin_id = top.get("id")
            details = requests.get(f"{self.coingecko_url}/coins/{coin_id}").json()

            return {
                "name": details.get("name"),
                "symbol": details.get("symbol"),
                "current_price_usd": details.get("market_data", {})
                .get("current_price", {})
                .get("usd"),
                "market_cap_rank": details.get("market_cap_rank"),
                "homepage": details.get("links", {}).get("homepage", [None])[0],
                "description": details.get("description", {}).get("en", "")[:600],
            }
        except Exception:
            return None

    def _search_defillama(self, query: str):
        try:
            res = requests.get(f"{self.defillama_url}{query}")
            if res.status_code == 200:
                j = res.json()
                return {
                    "name": j.get("name"),
                    "symbol": j.get("symbol"),
                    "chain": j.get("chain"),
                    "category": j.get("category"),
                    "tvl_usd": j.get("tvl"),
                    "description": j.get("description"),
                }
            return None
        except Exception:
            return None

    def _summarize(self, data):
        lines = []
        name = data.get("name", data["project"])
        lines.append(f"🧩 **{name.capitalize()}** — Web3 Intelligence Summary\n")
        if "current_price_usd" in data and data["current_price_usd"]:
            lines.append(f"💰 Current Price: ${data['current_price_usd']:.4f}")
        if "tvl_usd" in data and data["tvl_usd"]:
            lines.append(f"📊 TVL: ${data['tvl_usd']:,}")
        if "chain" in data and data["chain"]:
            lines.append(f"🔗 Chain: {data['chain']}")
        if "category" in data and data["category"]:
            lines.append(f"🏷️ Category: {data['category']}")
        if "market_cap_rank" in data and data["market_cap_rank"]:
            lines.append(f"📈 Market Cap Rank: #{data['market_cap_rank']}")
        if "homepage" in data and data["homepage"]:
            lines.append(f"🌐 Website: {data['homepage']}")

        desc = data.get("description", "")
        if desc:
            lines.append(f"\n📝 {desc.strip()}")

        return "\n".join(lines)


# === Unified Adapter for Base Agent Integration ===
def web3_agent(state):
    """
    Adapter to make Web3Agent compatible with Base Agent format.
    Accepts a state dict and returns a standardized response.
    """
    try:
        query = state.get("query", "")
        agent = Web3Agent()
        result = agent.get_project_info(query)
        summary = result.get("summary", "No summary available.")
        return {"response": summary}
    except Exception as e:
        return {"response": f"⚠️ Web3 agent error: {str(e)}"}
