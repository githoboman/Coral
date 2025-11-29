# app/services/agents/web3_agent.py
import aiohttp
import asyncio
import logging
import time
from typing import Dict, Optional, Any, List, Tuple
from datetime import datetime
import re
from dataclasses import dataclass, asdict
from enum import Enum
from collections import Counter
import json
from textblob import TextBlob

from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

# Import LLMFactory from the separate module
from app.services.agents.llm_factory import LLMFactory

logger = logging.getLogger(__name__)

# === CONFIG: Sui Mainnet RPC Endpoints (Failover List) ===
SUI_RPC_ENDPOINTS = [
    'https://fullnode.mainnet.sui.io:443',
    'https://mainnet.suiet.app',
    'https://rpc-mainnet.suiscan.xyz',
    'https://mainnet.sui.rpcpool.com',
    'https://sui-mainnet.nodeinfra.com',
    'https://mainnet-rpc.sui.chainbase.online',
    'https://sui-mainnet-ca-1.cosmostation.io',
    'https://sui-mainnet-ca-2.cosmostation.io',
    'https://sui-mainnet-us-1.cosmostation.io',
    'https://sui-mainnet-us-2.cosmostation.io',
]

# === DexScreener Endpoints ===
DEXSCREENER_SEARCH = "https://api.dexscreener.com/latest/dex/search?q="
DEXSCREENER_TOKEN = "https://api.dexscreener.com/latest/dex/tokens/"

# CoinGecko API (Free tier: 10-30 calls/minute)
COINGECKO_API = "https://api.coingecko.com/api/v3"

# === Cache TTL Strategy ===


class CacheStrategy(Enum):
    PRICE = 30
    MARKET = 60
    SOCIAL = 300  # 5 minutes
    RPC = 60
    OBJECT = 300
    LIST = 43200  # 12 hours


@dataclass
class CachedData:
    data: Any
    timestamp: float
    ttl: int

    def is_valid(self) -> bool:
        return (time.time() - self.timestamp) < self.ttl


# ===================================================================
# HELPER FUNCTIONS
# ===================================================================

async def _get_sui_ecosystem_overview(query: str, search_results: List[Dict], x_results: List[Dict]) -> str:
    """
    Get comprehensive Sui ecosystem overview using LLM synthesis and tool data.
    """
    try:
        logger.info(f"Generating Sui ecosystem overview for: {query}")

        # Use LLM to generate comprehensive ecosystem overview from tool data
        llm = await LLMFactory.get_llm(temperature=0.4)

        # Prepare tool data for prompt
        search_summary = "\n".join(
            [f"- {res.get('title', '')}: {res.get('snippet', '')[:150]}..." for res in search_results[:5]])
        x_buzz = "\n".join([post.get('text', '')[
                           :100] + '...' for post in x_results[:5] if 'Sui' in post.get('text', '')])

        prompt = ChatPromptTemplate.from_messages([
            ("system", """You are a Sui blockchain expert. Provide a comprehensive, engaging overview of the Sui ecosystem based on the provided search and X data.
Include:
1. Top 5-7 notable tokens/projects with brief descriptions (extract from data)
2. Current ecosystem stats (TVL, notable metrics from snippets)
3. Recent developments or trends (from X buzz and search)
4. Investment considerations and risks

Format in Markdown with a friendly, informative tone. Use emojis sparingly for visual appeal.
Be specific about project names and their use cases. Use current date for timeliness."""),
            ("human", f"User query: {query}\n\nSearch Data:\n{search_summary}\n\nX Buzz:\n{x_buzz}\n\nProvide an overview of notable Sui blockchain projects and tokens.")
        ])

        chain = prompt | llm | StrOutputParser()
        result = await chain.ainvoke({})

        current_date = datetime.utcnow().strftime('%Y-%m-%d')
        # Add header and footer
        return f"""# 🟡 Sui Ecosystem Overview

{result}

---

**Want deeper analysis?** Ask me about any specific token! Try:
- "Research SUI token"
- "Analyze CETUS"
- "Tell me about DEEP"
- "Check out SCA"

*Generated {current_date} {datetime.utcnow().strftime('%H:%M UTC')} | Always DYOR before investing!*"""

    except Exception as e:
        logger.error(f"Ecosystem overview generation failed: {e}")
        # Fallback to tool-synthesized (no static content)
        current_date = datetime.utcnow().strftime('%Y-%m-%d')
        top_tokens = []
        for res in search_results[:5]:
            names = re.findall(r'(SUI|CETUS|DEEP|SEND|SCA|SCLP|TURBOS|SSWP|VELVET|Almanak|HIPPO|LOFI|NAVI|BUCKET)',
                               (res.get('title', '') + ' ' + res.get('snippet', '')), re.IGNORECASE)
            for name in set(names)[:2]:
                top_tokens.append(name.upper())
        top_tokens = list(set(top_tokens))[:7]

        return f"""# 🟡 Top Sui Tokens to Watch ({current_date})

Based on recent search trends, here's a quick hit list of standout Sui tokens:

""" + "\n".join([f"### {i+1}. **{tok}**\nEmerging project in Sui DeFi—check recent buzz for details.\n" for i, tok in enumerate(top_tokens)]) + """

**Quick Tip:** Sui TVL is growing—watch for unlocks and new integrations. DYOR and start small!

Want me to analyze a specific token in detail? Just ask!"""


# ===================================================================
# ENHANCED MODULES (Integrated, Consolidated)
# ===================================================================

class DataFetcher:
    """Handles all API/RPC data fetching with caching and retry logic"""

    def __init__(self, retry_attempts: int = 3, timeout: int = 10):
        self._session: Optional[aiohttp.ClientSession] = None
        self.retry_attempts = retry_attempts
        self.timeout = timeout
        self.cache: Dict[str, CachedData] = {}

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=self.timeout),
                headers={
                    "Accept": "application/json",
                    "User-Agent": "Tovira-Web3-Agent/1.0"
                }
            )
        return self._session

    def _cache_get(self, key: str) -> Optional[Any]:
        c = self.cache.get(key)
        if c and c.is_valid():
            logger.debug(f"Cache HIT: {key}")
            return c.data
        elif c:
            logger.debug(f"Cache EXPIRED: {key}")
            del self.cache[key]
        return None

    def _cache_set(self, key: str, data: Any, ttl: int):
        self.cache[key] = CachedData(data=data, timestamp=time.time(), ttl=ttl)
        logger.debug(f"Cache SET: {key} TTL={ttl}s")

    async def _fetch_json(self, url: str) -> Optional[dict]:
        """Generic JSON fetcher with retry"""
        for attempt in range(1, self.retry_attempts + 1):
            try:
                session = await self._get_session()
                async with session.get(url) as resp:
                    if resp.status == 200:
                        return await resp.json()
                    else:
                        text = await resp.text()
                        logger.warning(
                            f"HTTP {resp.status} from {url} — {text[:100]}")
            except asyncio.TimeoutError:
                logger.warning(
                    f"Timeout fetching {url} (attempt {attempt}/{self.retry_attempts})")
            except asyncio.CancelledError:
                logger.warning(f"Request cancelled for {url}")
            except Exception as e:
                logger.error(f"Attempt {attempt} fetch {url} failed: {e}")

            if attempt < self.retry_attempts:
                await asyncio.sleep(0.5 * (2 ** (attempt - 1)))
        logger.error(f"Failed all attempts for {url}")
        return None

    async def _fetch_sui_rpc(self, payload: dict) -> Optional[dict]:
        """Try all Sui RPC endpoints"""
        for endpoint in SUI_RPC_ENDPOINTS:
            cache_key = f"rpc:{endpoint}:{hash(str(payload))}"
            cached = self._cache_get(cache_key)
            if cached:
                return cached

            try:
                session = await self._get_session()
                async with session.post(
                    endpoint,
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=8)
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        if "result" in data:
                            self._cache_set(cache_key, data,
                                            CacheStrategy.RPC.value)
                            logger.debug(f"RPC SUCCESS: {endpoint}")
                            return data
                        else:
                            err = data.get("error", {})
                            logger.warning(
                                f"RPC error from {endpoint}: {err.get('message', 'Unknown')}")
                    else:
                        text = await resp.text()
                        logger.warning(
                            f"HTTP {resp.status} from {endpoint}: {text[:100]}")
            except Exception as e:
                logger.debug(f"RPC {endpoint} failed: {e}")
                continue

        logger.error("All Sui RPC endpoints failed")
        return None

    async def fetch_dexscreener_data(self, token: str) -> Optional[Dict]:
        """Fetch from DexScreener"""
        cache_key = f"dexscreener:{token.lower()}"
        cached = self._cache_get(cache_key)
        if cached:
            return cached

        if token.startswith("0x"):
            url = f"{DEXSCREENER_TOKEN}{token.split('::')[0]}"
        else:
            url = f"{DEXSCREENER_SEARCH}{token}"

        data = await self._fetch_json(url)
        if not data or not data.get("pairs"):
            return None

        pair = data["pairs"][0]
        result = {
            "source": "dexscreener",
            "symbol": pair["baseToken"]["symbol"],
            "price_usd": float(pair.get("priceUsd", 0) or 0),
            "liquidity_usd": float(pair["liquidity"].get("usd", 0) or 0),
            "volume_24h": float(pair["volume"].get("h24", 0) or 0),
            "change_24h": float(pair["priceChange"].get("h24", 0) or 0),
            "fdv": float(pair.get("fdv", 0) or 0),
            "chain": pair["chainId"],
            "pair_url": pair.get("url"),
        }

        self._cache_set(cache_key, result, CacheStrategy.MARKET.value)
        return result

    async def fetch_coingecko_social(self, token_id: str) -> Optional[Dict]:
        """Fetch social metrics from CoinGecko (fallback for Twitter)"""
        cache_key = f"coingecko_social:{token_id.lower()}"
        cached = self._cache_get(cache_key)
        if cached:
            return cached

        url = f"{COINGECKO_API}/coins/{token_id}"
        data = await self._fetch_json(url)

        if not data:
            return None

        community = data.get("community_data", {})
        result = {
            "twitter_followers": community.get("twitter_followers", 0),
            "reddit_subscribers": community.get("reddit_subscribers", 0),
            "telegram_users": community.get("telegram_channel_user_count", 0),
            "facebook_likes": community.get("facebook_likes", 0),
            "alexa_rank": data.get("public_interest_stats", {}).get("alexa_rank"),
            "developer_score": data.get("developer_score", 0),
            "community_score": data.get("community_score", 0),
            "public_interest_score": data.get("public_interest_score", 0),
        }

        self._cache_set(cache_key, result, CacheStrategy.SOCIAL.value)
        return result

    async def get_sui_token_metadata(self, token_type: str) -> Optional[Dict]:
        """Fetch CoinMetadata from Sui RPC."""
        cache_key = f"coin_metadata:{token_type}"
        cached = self._cache_get(cache_key)
        if cached:
            return cached

        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "sui_getCoinMetadata",
            "params": [token_type]
        }

        result = await self._fetch_sui_rpc(payload)
        if not result or "result" not in result or not result["result"]:
            return None

        meta = result["result"]
        data = {
            "name": meta.get("name"),
            "symbol": meta.get("symbol"),
            "decimals": meta.get("decimals"),
            "description": meta.get("description"),
            "icon_url": meta.get("iconUrl"),
            "supply": meta.get("supply"),
            "id": meta.get("id"),
            "source": "sui_rpc"
        }

        self._cache_set(cache_key, data, CacheStrategy.MARKET.value)
        return data

    async def get_sui_object(self, object_id: str) -> Optional[Dict]:
        """Fetch any object (NFT, package, custom token)."""
        cache_key = f"object:{object_id}"
        cached = self._cache_get(cache_key)
        if cached:
            return cached

        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "sui_getObject",
            "params": [object_id, {"showContent": True, "showType": True}]
        }

        result = await self._fetch_sui_rpc(payload)
        if not result or "result" not in result or not result["result"].get("data"):
            return None

        obj = result["result"]["data"]
        content = obj.get("content", {})
        fields = content.get("fields", {})

        data = {
            "object_id": object_id,
            "type": obj.get("type"),
            "name": content.get("name") or fields.get("name"),
            "description": content.get("description") or fields.get("description"),
            "url": content.get("url") or fields.get("url"),
            "fields": fields,
            "source": "sui_rpc"
        }

        self._cache_set(cache_key, data, CacheStrategy.OBJECT.value)
        return data

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()


class SentimentAnalyzer:
    """Analyzes text sentiment using TextBlob"""

    def __init__(self):
        self.crypto_slang = {
            'hodl': 'hold positive',
            'moon': 'very positive increase',
            'rekt': 'very negative loss',
            'fud': 'fear negative',
            'fomo': 'excitement positive',
            'bearish': 'negative',
            'bullish': 'positive',
            'wen': 'when',
            'gm': 'good morning',
            'wagmi': 'positive optimistic',
            'ngmi': 'negative pessimistic',
        }

    def clean_text(self, text: str) -> str:
        """Clean and normalize text"""
        text = text.lower()

        # Replace crypto slang
        for slang, replacement in self.crypto_slang.items():
            text = text.replace(slang, replacement)

        # Remove URLs
        text = re.sub(r'http\S+|www\S+|https\S+', '', text)

        # Remove mentions and hashtags
        text = re.sub(r'@\w+', '', text)
        text = re.sub(r'#', '', text)

        # Remove special characters except spaces
        text = re.sub(r'[^\w\s]', ' ', text)

        # Remove extra whitespace
        text = ' '.join(text.split())

        return text

    def analyze_sentiment(self, text: str) -> Dict[str, Any]:
        """Analyze single text sentiment"""
        cleaned = self.clean_text(text)
        blob = TextBlob(cleaned)

        polarity = blob.sentiment.polarity  # -1 to +1
        subjectivity = blob.sentiment.subjectivity  # 0 to 1

        # Classify
        if polarity > 0.05:
            label = 'positive'
        elif polarity < -0.05:
            label = 'negative'
        else:
            label = 'neutral'

        return {
            'polarity': polarity,
            'subjectivity': subjectivity,
            'label': label,
            'cleaned_text': cleaned
        }

    def analyze_batch(self, texts: List[str]) -> Dict[str, Any]:
        """Analyze multiple texts and aggregate"""
        if not texts:
            return {
                'avg_polarity': 0,
                'sentiment_score': 50,
                'positive_pct': 0,
                'negative_pct': 0,
                'neutral_pct': 0,
                'total_count': 0,
                'top_keywords': []
            }

        results = [self.analyze_sentiment(t) for t in texts]

        # Calculate aggregates
        polarities = [r['polarity'] for r in results]
        labels = [r['label'] for r in results]

        avg_polarity = sum(polarities) / len(polarities)
        sentiment_score = ((avg_polarity + 1) / 2) * 100  # Convert to 0-100

        positive_pct = (labels.count('positive') / len(labels)) * 100
        negative_pct = (labels.count('negative') / len(labels)) * 100
        neutral_pct = (labels.count('neutral') / len(labels)) * 100

        # Extract keywords
        all_words = []
        for r in results:
            words = r['cleaned_text'].split()
            all_words.extend([w for w in words if len(w) > 3])

        top_keywords = [word for word, count in Counter(
            all_words).most_common(10)]

        return {
            'avg_polarity': avg_polarity,
            'sentiment_score': sentiment_score,
            'positive_pct': positive_pct,
            'negative_pct': negative_pct,
            'neutral_pct': neutral_pct,
            'total_count': len(texts),
            'top_keywords': top_keywords
        }


@dataclass
class HealthMetrics:
    overall_score: float  # 0-100
    liquidity_score: float
    volume_score: float
    volatility_score: float
    trend_score: float
    breakdown: Dict[str, Any]


class MetricsProcessor:
    """Processes and analyzes market metrics"""

    def __init__(self):
        # Fetch benchmarks dynamically (placeholder for tool integration)
        self.sui_benchmarks = self._fetch_benchmarks()

    async def _fetch_benchmarks(self) -> Dict:
        """Fetch real benchmarks via tool (e.g., DeFiLlama)"""
        # Placeholder: In prod, await browse_page("https://defillama.com/chain/Sui", "Extract TVL, avg liquidity, volume for Sui tokens")
        # For now, use approximate but note for update
        logger.info("Fetching dynamic Sui benchmarks...")
        return {
            'avg_liquidity': 500000,  # Update via tool
            'avg_volume_24h': 250000,
            'healthy_volatility_max': 15,
        }

    def calculate_health_score(self, market_data: Dict) -> HealthMetrics:
        """Calculate overall token health score (0-100)"""

        # 1. Liquidity Score (0-100): Higher is better
        liquidity = market_data.get('liquidity_usd', 0)
        liquidity_score = min(
            100, (liquidity / self.sui_benchmarks['avg_liquidity']) * 50)

        # 2. Volume Score (0-100): Higher trading volume is better
        volume = market_data.get('volume_24h', 0)
        volume_score = min(
            100, (volume / self.sui_benchmarks['avg_volume_24h']) * 50)

        # 3. Volatility Score (0-100): Lower volatility is better for stability
        change_24h = abs(market_data.get('change_24h', 0))
        if change_24h > self.sui_benchmarks['healthy_volatility_max']:
            volatility_score = max(
                0, 100 - (change_24h - self.sui_benchmarks['healthy_volatility_max']) * 3)
        else:
            volatility_score = 100

        # 4. Trend Score (0-100): Positive price action
        price_change = market_data.get('change_24h', 0)
        if price_change > 0:
            trend_score = min(100, 50 + price_change * 2)
        else:
            trend_score = max(0, 50 + price_change * 2)

        # Weighted overall score
        overall_score = (
            liquidity_score * 0.30 +
            volume_score * 0.25 +
            volatility_score * 0.25 +
            trend_score * 0.20
        )

        return HealthMetrics(
            overall_score=round(overall_score, 2),
            liquidity_score=round(liquidity_score, 2),
            volume_score=round(volume_score, 2),
            volatility_score=round(volatility_score, 2),
            trend_score=round(trend_score, 2),
            breakdown={
                'liquidity': liquidity,
                'volume_24h': volume,
                'price_change_24h': price_change,
                'volatility': change_24h
            }
        )

    def detect_anomalies(self, market_data: Dict, health: HealthMetrics) -> List[Dict[str, str]]:
        """Detect potential issues/anomalies"""
        anomalies = []

        # Low liquidity risk
        if market_data.get('liquidity_usd', 0) < 50000:
            anomalies.append({
                'type': 'low_liquidity',
                'severity': 'high',
                'description': f"Very low liquidity (${market_data.get('liquidity_usd', 0):,.0f}). High slippage risk."
            })

        # Volume spike
        liquidity = market_data.get('liquidity_usd', 1)
        volume = market_data.get('volume_24h', 0)
        volume_ratio = volume / liquidity if liquidity > 0 else 0

        if volume_ratio > 2.0:
            anomalies.append({
                'type': 'volume_spike',
                'severity': 'medium',
                'description': f"Unusual volume spike ({volume_ratio:.1f}x liquidity). Potential pump activity."
            })

        # Extreme volatility
        if abs(market_data.get('change_24h', 0)) > 50:
            anomalies.append({
                'type': 'extreme_volatility',
                'severity': 'high',
                'description': f"Extreme price volatility ({market_data.get('change_24h', 0):+.1f}%). High risk."
            })

        # Very low volume
        if volume < 10000 and market_data.get('liquidity_usd', 0) > 100000:
            anomalies.append({
                'type': 'low_activity',
                'severity': 'medium',
                'description': "Very low trading activity despite sufficient liquidity."
            })

        return anomalies

    def compare_to_benchmarks(self, market_data: Dict) -> Dict[str, str]:
        """Compare token to Sui ecosystem benchmarks"""
        comparisons = {}

        liquidity = market_data.get('liquidity_usd', 0)
        volume = market_data.get('volume_24h', 0)

        # Liquidity comparison
        liq_vs_avg = (liquidity / self.sui_benchmarks['avg_liquidity']) * 100
        if liq_vs_avg > 150:
            comparisons['liquidity'] = f"Excellent: {liq_vs_avg:.0f}% vs Sui average"
        elif liq_vs_avg > 75:
            comparisons['liquidity'] = f"Good: {liq_vs_avg:.0f}% vs Sui average"
        else:
            comparisons['liquidity'] = f"Below average: {liq_vs_avg:.0f}% vs Sui average"

        # Volume comparison
        vol_vs_avg = (volume / self.sui_benchmarks['avg_volume_24h']) * 100
        if vol_vs_avg > 150:
            comparisons['volume'] = f"Very active: {vol_vs_avg:.0f}% vs Sui average"
        elif vol_vs_avg > 75:
            comparisons['volume'] = f"Active: {vol_vs_avg:.0f}% vs Sui average"
        else:
            comparisons['volume'] = f"Low activity: {vol_vs_avg:.0f}% vs Sui average"

        return comparisons


class Reporter:
    """Generates structured JSON and Markdown reports"""

    @staticmethod
    def generate_recommendation(health: HealthMetrics, anomalies: List[Dict], sentiment: Dict) -> Dict[str, Any]:
        """Generate investment recommendation"""
        score = health.overall_score
        risk_level = "high" if anomalies else (
            "medium" if score < 60 else "low")

        # Determine recommendation
        if score >= 75 and sentiment.get('sentiment_score', 50) > 60 and not any(a['severity'] == 'high' for a in anomalies):
            recommendation = "Buy"
            confidence = "High"
            rationale = "Strong fundamentals, positive sentiment, and healthy metrics."
        elif score >= 60 or sentiment.get('sentiment_score', 50) > 55:
            recommendation = "Hold"
            confidence = "Medium"
            rationale = "Moderate metrics with acceptable risk levels."
        else:
            recommendation = "Sell / Avoid"
            confidence = "Medium"
            rationale = "Weak fundamentals, concerning metrics, or high risk indicators."

        return {
            'recommendation': recommendation,
            'confidence': confidence,
            'risk_level': risk_level,
            'rationale': rationale,
            'health_score': score,
            'sentiment_score': sentiment.get('sentiment_score', 50)
        }

    @staticmethod
    def generate_json_report(token: str, market_data: Dict, health: HealthMetrics,
                             sentiment: Dict, social_data: Optional[Dict],
                             anomalies: List[Dict], comparisons: Dict) -> Dict:
        """Generate complete JSON report"""

        recommendation = Reporter.generate_recommendation(
            health, anomalies, sentiment)

        return {
            'token': token,
            'timestamp': datetime.utcnow().isoformat(),
            'data_sources': list(filter(None, [
                market_data.get('source'),
                'coingecko' if social_data else None,
                'textblob_sentiment'
            ])),
            'metrics': {
                'price_usd': market_data.get('price_usd'),
                'liquidity_usd': market_data.get('liquidity_usd'),
                'volume_24h': market_data.get('volume_24h'),
                'price_change_24h': market_data.get('change_24h'),
                'fdv': market_data.get('fdv'),
                'chain': market_data.get('chain'),
            },
            'health': asdict(health),
            'sentiment': sentiment,
            'social_metrics': social_data or {},
            'anomalies': anomalies,
            'comparisons': comparisons,
            'recommendation': recommendation
        }

    @staticmethod
    async def generate_markdown_report(json_report: Dict, output_style: str = "full") -> str:
        """Generate human-like, narrative-driven Markdown report; adapt to style"""
        token = json_report['token']
        metrics = json_report['metrics']
        health = json_report['health']
        sentiment = json_report['sentiment']
        rec = json_report['recommendation']
        anomalies = json_report['anomalies']
        comparisons = json_report['comparisons']

        if output_style == "quick":
            # Concise version
            price_change = metrics['price_change_24h']
            return f"""**{token} Quick Check** (${metrics['price_usd']:,.4f}, {price_change:+.1f}% 24h)
- Liquidity: ${metrics['liquidity_usd']:,.0f} | Volume: ${metrics['volume_24h']:,.0f}
- Health: {health['overall_score']:.0f}/100 | Rec: {rec['recommendation']} ({rec['risk_level']} risk)
*DYOR!*"""

        # Full narrative (original logic, but use LLM for dynamism)
        try:
            llm = await LLMFactory.get_llm(temperature=0.3)
            prompt = ChatPromptTemplate.from_messages([
                ("system", """You are a crypto analyst. Generate an engaging, narrative Markdown report for a token based on the JSON data.
Keep it conversational: use analogies, vibes, and personal takes. Structure:
- Header with emoji/vibe
- Quick Pulse table
- Health Check table + breakdown
- Sentiment section
- Benchmarks/Anomalies if relevant
- Recommendation with rationale

Adapt tone to data (bullish/green, neutral/yellow, bearish/red). Use current metrics. End with DYOR footer."""),
                ("human",
                 f"JSON Report: {json.dumps(json_report, indent=2)}\n\nOutput full Markdown report.")
            ])
            chain = prompt | llm | StrOutputParser()
            result = await chain.ainvoke({})
            return result
        except Exception as e:
            logger.error(f"LLM report gen failed: {e}")
            # Fallback to static template (trimmed)
            current_date = json_report['timestamp'][:10]
            emoji = "🟢" if rec['recommendation'] == "Buy" else (
                "🟡" if rec['recommendation'] == "Hold" else "🔴")
            return f"""# {emoji} {token} Analysis ({current_date})

**Price:** ${metrics['price_usd']:,.4f} | **24h:** {metrics['price_change_24h']:+.1f}%
**Health Score:** {health['overall_score']:.0f}/100 | **Rec:** {rec['recommendation']}

| Metric | Value |
|--------|-------|
| Liquidity | ${metrics['liquidity_usd']:,.0f} |
| Volume 24h | ${metrics['volume_24h']:,.0f} |

**Sentiment:** {sentiment.get('sentiment_score', 50):.0f}/100 ({sentiment.get('positive_pct', 0):.0f}% positive)

{rec['rationale']}

*DYOR - Not financial advice.*"""


# ===================================================================
# UPDATED Web3Agent CLASS (Streamlined)
# ===================================================================

class Web3Agent:
    """Async context manager for agent lifecycle"""

    def __init__(self, retry_attempts: int = 3, backoff_base: float = 0.8, session_timeout: int = 10):
        self.retry_attempts = retry_attempts
        self.backoff_base = backoff_base
        self.session_timeout = session_timeout
        # Single fetcher instance (no redundant session/cache)
        self.fetcher = DataFetcher(retry_attempts, session_timeout)
        self.sentiment = SentimentAnalyzer()
        self.processor = MetricsProcessor()

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()

    def extract_token(self, query: str) -> Dict[str, str]:
        """Consolidated token extraction with regex + lookup (fallback for LLM)"""
        query_lower = query.lower().strip()

        # Known non-Sui mappings
        non_sui_tokens = {
            'btc': 'bitcoin', 'bitcoin': 'bitcoin',
            'eth': 'ethereum', 'ethereum': 'ethereum',
            'sol': 'solana', 'solana': 'solana',
            'bnb': 'binance', 'binance': 'binance',
            'usdt': 'ethereum', 'usdc': 'usd-coin',
            'avax': 'avalanche', 'avalanche': 'avalanche',
            'matic': 'polygon', 'polygon': 'polygon',
            'dot': 'polkadot', 'polkadot': 'polkadot',
            'ada': 'cardano', 'cardano': 'cardano',
            'atom': 'cosmos', 'cosmos': 'cosmos',
            'link': 'ethereum', 'chainlink': 'ethereum',
            'uni': 'ethereum', 'uniswap': 'ethereum',
            'doge': 'dogecoin', 'dogecoin': 'dogecoin',
            'shib': 'ethereum', 'shiba': 'ethereum',
        }

        # Ecosystem keywords
        ecosystem_keywords = [
            'tokens on sui', 'sui tokens', 'sui gems', 'sui projects',
            'undervalued sui', 'hot sui', 'top sui', 'best sui',
            'sui ecosystem', 'sui defi'
        ]
        if any(keyword in query_lower for keyword in ecosystem_keywords):
            return {'type': 'ecosystem_overview', 'token': None, 'chain': 'sui'}

        # Flexible regex: $TICKER, verbs+TICKER, or standalone uppercase/lowercase (non-stopwords)
        token_match = re.search(
            r'(?:research|check|analyze|look up|price of)?\s*\$?([A-Za-z0-9]{2,15})\b', query, re.IGNORECASE)
        if token_match:
            token = token_match.group(1).upper()
            if token.lower() in non_sui_tokens:
                return {'type': 'other_chain', 'token': token, 'chain': non_sui_tokens[token.lower()]}
            return {'type': 'token', 'token': token, 'chain': 'sui'}

        # Fallback: standalone alphanum (avoid stopwords)
        stopwords = {'the', 'and', 'for', 'token',
                     'research', 'on', 'of', 'in', 'to'}
        token_match = re.search(r'\b([A-Za-z]{2,15})\b', query)
        if token_match and token_match.group(1).lower() not in stopwords:
            token = token_match.group(1).upper()
            if token.lower() in non_sui_tokens:
                return {'type': 'other_chain', 'token': token, 'chain': non_sui_tokens[token.lower()]}
            return {'type': 'token', 'token': token, 'chain': 'sui'}

        # Default
        if query_lower in non_sui_tokens:
            return {'type': 'other_chain', 'token': query.strip().upper(), 'chain': non_sui_tokens[query_lower]}
        return {'type': 'token', 'token': query.strip().upper(), 'chain': 'sui'}

    async def fetch_token_data(self, token: str) -> Optional[Dict]:
        """Main entry: Try Sui RPC → fallback to DexScreener (uses fetcher cache only)"""
        cache_key = f"market:{token.lower()}"
        cached = self.fetcher._cache_get(cache_key)  # Access via fetcher
        if cached:
            return cached

        result = None

        # === 1. Try as Full Coin Type (e.g. 0x...::sca::SCA) ===
        if "::" in token and token.startswith("0x"):
            logger.debug(f"Trying Sui RPC for coin type: {token}")
            rpc_data = await self.fetcher.get_sui_token_metadata(token)
            if rpc_data:
                result = {
                    "source": "sui_rpc",
                    "symbol": rpc_data["symbol"],
                    "name": rpc_data["name"],
                    "decimals": rpc_data["decimals"],
                    "icon_url": rpc_data["icon_url"],
                    "supply": rpc_data["supply"],
                    "chain": "sui",
                    "type": token,
                }

        # === 2. Try as Object ID (64 hex chars) ===
        elif re.match(r'^0x[a-fA-F0-9]{64}$', token):
            logger.debug(f"Trying Sui RPC for object: {token}")
            obj_data = await self.fetcher.get_sui_object(token)
            if obj_data:
                result = {
                    "source": "sui_rpc",
                    "symbol": obj_data["fields"].get("symbol", "NFT"),
                    "name": obj_data["name"] or "Unknown",
                    "description": obj_data["description"],
                    "url": obj_data["url"],
                    "object_id": token,
                    "chain": "sui",
                    "is_nft": True,
                }

        # === 3. Fallback: DexScreener ===
        if not result:
            logger.debug("Falling back to DexScreener")
            result = await self.fetcher.fetch_dexscreener_data(token)
            if not result:
                return None

        # === 4. Enrich RPC data with price (if missing) ===
        if result.get("source") == "sui_rpc" and "price_usd" not in result:
            ds_data = await self.fetcher.fetch_dexscreener_data(token)
            if ds_data:
                result.update({
                    "price_usd": ds_data.get("price_usd", 0),
                    "liquidity_usd": ds_data.get("liquidity_usd"),
                    "volume_24h": ds_data.get("volume_24h"),
                    "change_24h": ds_data.get("change_24h"),
                    "fdv": ds_data.get("fdv"),
                    "pair_url": ds_data.get("pair_url"),
                })

        result["last_updated"] = datetime.utcnow().isoformat()
        self.fetcher._cache_set(cache_key, result, CacheStrategy.MARKET.value)
        return result

    async def get_comprehensive_data(self, query: str) -> Dict:
        match = re.search(r'\$?([A-Za-z0-9]{2,15})\b', query, re.IGNORECASE)
        token = (match.group(1) if match else "SUI").upper()

        # Allow full type or object ID in query
        if re.match(r'^0x[a-fA-F0-9:\_]+$', query.strip()):
            token = query.strip()

        data = await self.fetch_token_data(token)
        if not data:
            return {
                "query": query,
                "success": False,
                "message": f"No data found for '{token}'. Try a different symbol or address.",
                "timestamp": datetime.utcnow().isoformat()
            }

        return {
            "query": query,
            "success": True,
            "timestamp": datetime.utcnow().isoformat(),
            "sources": [data.get("source")],
            "data": data
        }

    async def _detect_token_or_intent(self, query: str) -> Dict[str, str]:
        """LLM helper: Extract token or flag as overview (handles creative phrasing)"""
        try:
            llm = await LLMFactory.get_llm(temperature=0.1)
            prompt = ChatPromptTemplate.from_messages([
                ("system", """Analyze the query for Web3/Sui blockchain context ONLY.
- If it mentions a specific token/symbol (e.g., SUI, CETUS, DEEP, SCA) or Sui address (0x...), extract it as 'token'.
- If it mentions tokens from OTHER chains (BTC, ETH, SOL, AVAX, etc.), respond with 'other_chain' and the chain name.
- If it's broad Sui ecosystem research (e.g., 'tokens on Sui', 'Sui gems'), classify as 'ecosystem_overview'.
- Respond as JSON: {{"type": "token" or "ecosystem_overview" or "other_chain", "token": "extracted_symbol_or_null", "chain": "chain_name_if_other"}}.

Examples:
Query: "Research SUI" → {{"type": "token", "token": "SUI", "chain": "sui"}}
Query: "Research CETUS token" → {{"type": "token", "token": "CETUS", "chain": "sui"}}
Query: "Check BTC price" → {{"type": "other_chain", "token": "BTC", "chain": "bitcoin"}}
Query: "What tokens on Sui?" → {{"type": "ecosystem_overview", "token": null, "chain": "sui"}}"""),
                ("human", f"Query: {query}")
            ])
            chain = prompt | llm | StrOutputParser()
            result = await asyncio.wait_for(chain.ainvoke({}), timeout=8.0)

            # Parse JSON (handle errors gracefully)
            try:
                cleaned_result = result.strip()
                if cleaned_result.startswith('```'):
                    cleaned_result = re.sub(
                        r'```json?\s*|\s*```', '', cleaned_result).strip()

                parsed = json.loads(cleaned_result)

                # Validate structure
                valid_types = ['token', 'ecosystem_overview', 'other_chain']
                if 'type' not in parsed or parsed['type'] not in valid_types:
                    raise ValueError("Invalid type in response")

                return parsed

            except (json.JSONDecodeError, ValueError):
                logger.warning(f"JSON parse error. Falling back to regex.")
                return self.extract_token(query)

        except Exception as e:
            logger.warning(
                f"LLM intent detection failed: {e}. Falling back to regex.")
            return self.extract_token(query)

    async def analyze(self, query: str) -> str:
        """Enhanced analyze: LLM-powered token/intent detection for flexibility"""
        try:
            # Step 1: Detect intent (LLM primary, regex fallback)
            llm_intent = await self._detect_token_or_intent(query)
            output_style = "quick" if any(word in query.lower() for word in [
                                          "quick", "price", "summary"]) else "full"

            if llm_intent.get('type') == 'ecosystem_overview':
                # Broad: Use tools for dynamic recs
                logger.debug(f"Detected broad Sui query: {query}")
                # Real tool calls (assume imported/available in env)
                search_results = await web_search(f"top Sui tokens to watch {datetime.utcnow().strftime('%B %Y')}", num_results=5)
                x_results = await x_keyword_search("Sui tokens OR Sui DeFi gems since:2025-11-01", limit=5, mode="Latest")
                return await _get_sui_ecosystem_overview(query, search_results, x_results)

            # Step 2: Specific token
            token = llm_intent.get('token', query)
            if llm_intent.get('type') == 'other_chain':
                return f" This agent focuses on Sui. For {token} on {llm_intent['chain']}, try a general crypto tool!"

            comp_data = await asyncio.wait_for(self.get_comprehensive_data(token), timeout=25.0)
            if not comp_data.get("success"):
                return f" {comp_data.get('message', 'No data found—try another token!')}"

            token_symbol = comp_data['data'].get('symbol', 'UNKNOWN')
            market_data = comp_data['data']

            # Fetch social data (expanded mapping via tool if needed)
            coingecko_map = {
                'SUI': 'sui', 'BTC': 'bitcoin', 'ETH': 'ethereum',
                'USDC': 'usd-coin', 'USDT': 'tether'
            }
            token_id = coingecko_map.get(token_symbol, token_symbol.lower())
            social_data = await self.fetcher.fetch_coingecko_social(token_id)

            # Calculate health (now async for benchmarks)
            await self.processor._fetch_benchmarks()  # Refresh if needed
            health = self.processor.calculate_health_score(market_data)

            # Anomalies & benchmarks
            anomalies = self.processor.detect_anomalies(market_data, health)
            comparisons = self.processor.compare_to_benchmarks(market_data)

            # Real sentiment from X (no samples)
            x_posts = await x_semantic_search(f"{token_symbol} sentiment OR {token_symbol} price OR {token_symbol} bullish OR {token_symbol} bearish", limit=10)
            sentiment_texts = [post.get('text', '') for post in x_posts]
            sentiment_analysis = self.sentiment.analyze_batch(sentiment_texts)

            # Generate report
            json_report = Reporter.generate_json_report(
                token=token_symbol,
                market_data=market_data,
                health=health,
                sentiment=sentiment_analysis,
                social_data=social_data,
                anomalies=anomalies,
                comparisons=comparisons
            )

            return await Reporter.generate_markdown_report(json_report, output_style)

        except asyncio.TimeoutError:
            logger.error("Web3 analysis timeout")
            return "⏰ Market data request timed out. Please try again."
        except asyncio.CancelledError:
            logger.warning("Web3 analysis cancelled")
            return " Request was cancelled."
        except Exception as e:
            logger.exception(f"Web3 analysis error: {e}")
            return f"  Error: {str(e)[:100]}"

    def format_summary(self, data: Dict) -> str:
        """Preserved for backward compatibility: Simple text summary"""
        if not data.get("success"):
            return f"{data.get('message')}"

        info = data["data"]
        lines = []

        if info.get("is_nft"):
            name = info.get("name", "NFT")
            lines.append(f"**{name} (NFT)**\n")
            if info.get("description"):
                desc = info["description"][:200]
                if len(info["description"]) > 200:
                    desc += "..."
                lines.append(f"_{desc}_")
            if info.get("url"):
                lines.append(f"[View NFT]({info['url']})")
            lines.append(f"Object: `{info['object_id']}`")
        else:
            symbol = info.get("symbol", "UNKNOWN")
            lines.append(f"**{symbol} Market Data**\n")
            if info.get("price_usd") > 0:
                lines.append(
                    f"Price: ${info['price_usd']:,.8f}".rstrip('0').rstrip('.'))
            if info.get("liquidity_usd") is not None and info["liquidity_usd"] > 0:
                lines.append(f"Liquidity: ${info['liquidity_usd']:,.0f}")
            if info.get("volume_24h") is not None and info["volume_24h"] > 0:
                lines.append(f"24h Volume: ${info['volume_24h']:,.0f}")
            if info.get("change_24h") is not None:
                lines.append(f"Change 24h: {info['change_24h']:+.2f}%")
            if info.get("fdv") is not None and info["fdv"] > 0:
                lines.append(f"FDV: ${info['fdv']:,.0f}")
            if info.get("pair_url"):
                lines.append(f"[View on DexScreener]({info['pair_url']})")

        source = info.get("source", "unknown").replace("_", " ").title()
        lines.append(f"\n*Source: {source}*")
        return "\n".join(lines)

    async def close(self):
        await self.fetcher.close()
        logger.info("Web3 session closed")


# === Global Instance ===
_web3_agent = Web3Agent()


async def web3_agent_tool_async(query: str, context: str = "") -> str:
    logger.info(f"Web3 tool called: {query}")
    async with _web3_agent as agent:  # Use context manager
        return await agent.analyze(query)


async def shutdown_web3_agent():
    await _web3_agent.close()


# ===================================================================
# MAIN ENTRY POINT (For Testing)
# ===================================================================

async def main():
    """Example usage"""
    print("=" * 80)
    print("ENHANCED WEB3 RESEARCH AGENT - SUI BLOCKCHAIN")
    print("=" * 80)
    print()

    token = "SUI"
    result = await web3_agent_tool_async(token)
    print(result)

    print()
    print(f" Analysis complete for {token}")

    # Cleanup
    await shutdown_web3_agent()

if __name__ == "__main__":
    asyncio.run(main())
