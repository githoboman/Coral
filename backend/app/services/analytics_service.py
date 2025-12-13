# app/services/analytics_service.py
import asyncio
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
import httpx
from collections import defaultdict

logger = logging.getLogger(__name__)

COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3"
SUI_RPC_URL = "https://fullnode.mainnet.sui.io:443"


class AnalyticsService:
    """Service for wallet analytics and blockchain data processing"""

    def __init__(self):
        self.timeout = httpx.Timeout(30.0)
        self.price_cache = {}  # Simple in-memory cache
        self.cache_duration = 300  # 5 minutes

    async def get_wallet_overview(self, address: str) -> Dict[str, Any]:
        """
        Fetch comprehensive wallet overview with balances and enriched price data
        
        Args:
            address: Sui wallet address
            
        Returns:
            Dictionary with balances, prices, and calculated metrics
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                # Fetch all balances
                balance_response = await client.post(
                    SUI_RPC_URL,
                    json={
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "suix_getAllBalances",
                        "params": [address]
                    }
                )
                
                if balance_response.status_code != 200:
                    return {"success": False, "error": "Failed to fetch balances"}
                
                balance_data = balance_response.json()
                balances = balance_data.get("result", [])
                
                # Enrich with price data
                enriched_balances = await self._enrich_balances_with_prices(balances)
                
                # Calculate total portfolio value
                total_value = sum(b.get("value_usd", 0) for b in enriched_balances)
                
                # Get basic stats
                num_tokens = len(enriched_balances)
                
                return {
                    "success": True,
                    "data": {
                        "balances": enriched_balances,
                        "total_value_usd": total_value,
                        "num_tokens": num_tokens,
                        "timestamp": datetime.utcnow().isoformat()
                    }
                }
                
        except Exception as e:
            logger.exception(f"Error fetching wallet overview: {e}")
            return {"success": False, "error": str(e)}

    async def _enrich_balances_with_prices(self, balances: List[Dict]) -> List[Dict]:
        """Enrich balance data with current prices"""
        enriched = []
        
        for balance in balances:
            coin_type = balance.get("coinType", "")
            total_balance = int(balance.get("totalBalance", 0))
            
            # Determine decimals and symbol
            if "::sui::SUI" in coin_type:
                decimals = 9
                symbol = "SUI"
                price_data = await self._get_token_price("sui")
            else:
                # For other tokens, use default decimals
                decimals = 9
                symbol = coin_type.split("::")[-1] if "::" in coin_type else "UNKNOWN"
                price_data = None  # We'll need a token registry for other tokens
            
            amount = total_balance / (10 ** decimals)
            price_usd = price_data.get("price_usd", 0) if price_data else 0
            value_usd = amount * price_usd
            
            enriched.append({
                "coinType": coin_type,
                "symbol": symbol,
                "decimals": decimals,
                "totalBalance": total_balance,
                "amount": amount,
                "price_usd": price_usd,
                "value_usd": value_usd,
                "price_change_24h": price_data.get("price_change_24h", 0) if price_data else 0
            })
        
        # Sort by value descending
        enriched.sort(key=lambda x: x.get("value_usd", 0), reverse=True)
        return enriched

    async def _get_token_price(self, token_id: str) -> Optional[Dict[str, Any]]:
        """
        Fetch token price from CoinGecko with caching
        
        Args:
            token_id: CoinGecko token ID (e.g., 'sui')
        """
        # Check cache
        cache_key = f"price_{token_id}"
        if cache_key in self.price_cache:
            cached_data, cached_time = self.price_cache[cache_key]
            if (datetime.utcnow() - cached_time).seconds < self.cache_duration:
                return cached_data
        
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    f"{COINGECKO_BASE_URL}/simple/price",
                    params={
                        "ids": token_id,
                        "vs_currencies": "usd",
                        "include_24hr_change": "true"
                    }
                )
                
                if response.status_code == 200:
                    data = response.json()
                    if token_id in data:
                        price_data = {
                            "price_usd": data[token_id].get("usd", 0),
                            "price_change_24h": data[token_id].get("usd_24h_change", 0)
                        }
                        # Cache the result
                        self.price_cache[cache_key] = (price_data, datetime.utcnow())
                        return price_data
                        
        except Exception as e:
            logger.error(f"Error fetching price for {token_id}: {e}")
        
        return None

    async def get_transaction_history(
        self, 
        address: str, 
        limit: int = 50,
        cursor: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Fetch transaction history for a wallet
        
        Args:
            address: Sui wallet address
            limit: Maximum number of transactions to fetch
            cursor: Pagination cursor
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                params = {
                    "filter": {"FromAddress": address},
                    "limit": limit,
                    "order": "descending"
                }
                
                if cursor:
                    params["cursor"] = cursor
                
                response = await client.post(
                    SUI_RPC_URL,
                    json={
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "suix_queryTransactionBlocks",
                        "params": [params]
                    }
                )
                
                if response.status_code != 200:
                    return {"success": False, "error": "Failed to fetch transactions"}
                
                data = response.json()
                result = data.get("result", {})
                
                transactions = result.get("data", [])
                next_cursor = result.get("nextCursor")
                has_next = result.get("hasNextPage", False)
                
                # Process transactions
                processed_txs = []
                for tx in transactions:
                    processed_txs.append({
                        "digest": tx.get("digest"),
                        "timestamp": tx.get("timestampMs"),
                        "checkpoint": tx.get("checkpoint")
                    })
                
                return {
                    "success": True,
                    "data": {
                        "transactions": processed_txs,
                        "nextCursor": next_cursor,
                        "hasNextPage": has_next,
                        "total": len(processed_txs)
                    }
                }
                
        except Exception as e:
            logger.exception(f"Error fetching transaction history: {e}")
            return {"success": False, "error": str(e)}

    async def calculate_basic_stats(self, address: str) -> Dict[str, Any]:
        """
        Calculate basic trading statistics from transaction history
        
        Note: This is a simplified version. Full PnL requires detailed transaction parsing.
        """
        try:
            # Fetch recent transactions
            tx_result = await self.get_transaction_history(address, limit=100)
            
            if not tx_result.get("success"):
                return {"success": False, "error": "Failed to fetch transactions"}
            
            transactions = tx_result["data"]["transactions"]
            
            # Basic stats
            total_transactions = len(transactions)
            
            # For now, return placeholder stats
            # Full implementation would parse transaction details
            return {
                "success": True,
                "data": {
                    "total_transactions": total_transactions,
                    "total_volume": 0,  # Requires transaction detail parsing
                    "realized_pnl": 0,  # Requires buy/sell matching
                    "win_rate": 0,  # Requires trade analysis
                    "note": "Basic stats only. Full PnL calculation requires detailed transaction parsing."
                }
            }
            
        except Exception as e:
            logger.exception(f"Error calculating stats: {e}")
            return {"success": False, "error": str(e)}

    async def get_wallet_nfts(self, address: str, limit: int = 50) -> Dict[str, Any]:
        """
        Fetch NFTs owned by wallet
        
        Args:
            address: Sui wallet address
            limit: Maximum number of NFTs to fetch
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    SUI_RPC_URL,
                    json={
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "suix_getOwnedObjects",
                        "params": [
                            address,
                            {
                                "filter": {"MatchNone": [{"StructType": "0x2::coin::Coin"}]},
                                "options": {
                                    "showType": True,
                                    "showContent": True,
                                    "showDisplay": True
                                }
                            },
                            None,
                            limit
                        ]
                    }
                )
                
                if response.status_code != 200:
                    return {"success": False, "error": "Failed to fetch NFTs"}
                
                data = response.json()
                result = data.get("result", {})
                objects = result.get("data", [])
                
                # Process NFTs
                nfts = []
                for obj in objects:
                    obj_data = obj.get("data", {})
                    display_data = obj_data.get("display", {})
                    display = display_data.get("data", {}) if display_data else {}
                    
                    nfts.append({
                        "objectId": obj_data.get("objectId"),
                        "type": obj_data.get("type"),
                        "name": display.get("name", "Unknown NFT") if display else "Unknown NFT",
                        "description": display.get("description", "") if display else "",
                        "image_url": display.get("image_url", "") if display else "",
                        "link": display.get("link", "") if display else "",
                        "project_url": display.get("project_url", "") if display else ""
                    })
                
                return {
                    "success": True,
                    "data": {
                        "nfts": nfts,
                        "total": len(nfts)
                    }
                }
                
        except Exception as e:
            logger.exception(f"Error fetching NFTs: {e}")
            return {"success": False, "error": str(e)}


# Singleton instance
analytics_service = AnalyticsService()
