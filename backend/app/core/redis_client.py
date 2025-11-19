# app/core/redis_client.py
import redis.asyncio as aioredis
import json
import logging
from typing import Optional, Any
from datetime import timedelta

from app.core.config import settings

logger = logging.getLogger(__name__)


class RedisCache:
    """
    Async Redis cache client for Tovira.
    
    Features:
    - Async/await API
    - JSON serialization
    - TTL support
    - Connection pooling
    - Error resilience
    """
    
    def __init__(self):
        self.redis: Optional[aioredis.Redis] = None
        self._connection_pool: Optional[aioredis.ConnectionPool] = None
    
    async def connect(self) -> bool:
        """
        Initialize Redis connection with connection pooling.
        
        Returns:
            True if connected successfully, False otherwise
        """
        if not settings.ENABLE_REDIS_CACHE:
            logger.info("Redis cache disabled in settings")
            return False
        
        try:
            # Create connection pool
            self._connection_pool = aioredis.ConnectionPool.from_url(
                settings.REDIS_URL,
                password=settings.REDIS_PASSWORD if settings.REDIS_PASSWORD else None,
                encoding="utf-8",
                decode_responses=True,
                max_connections=20,
                socket_connect_timeout=5,
                socket_keepalive=True,
            )
            
            # Create Redis client
            self.redis = aioredis.Redis(connection_pool=self._connection_pool)
            
            # Test connection
            await self.redis.ping()
            
            logger.info("✓ Redis cache connected successfully")
            return True
            
        except aioredis.ConnectionError as e:
            logger.error(f"Redis connection failed: {e}")
            self.redis = None
            return False
        except Exception as e:
            logger.error(f"Redis initialization error: {e}")
            self.redis = None
            return False
    
    async def get(self, key: str) -> Optional[Any]:
        """
        Get value from cache.
        
        Args:
            key: Cache key
        
        Returns:
            Cached value (deserialized from JSON) or None if not found
        """
        if not self.redis:
            return None
        
        try:
            value = await self.redis.get(key)
            if value is None:
                return None
            
            # Deserialize JSON
            return json.loads(value)
            
        except json.JSONDecodeError as e:
            logger.warning(f"Failed to decode cached value for key '{key}': {e}")
            # Delete corrupted cache entry
            await self.delete(key)
            return None
        except Exception as e:
            logger.error(f"Redis get error for key '{key}': {e}")
            return None
    
    async def set(
        self,
        key: str,
        value: Any,
        ttl: Optional[int] = None
    ) -> bool:
        """
        Set value in cache with optional TTL.
        
        Args:
            key: Cache key
            value: Value to cache (will be JSON serialized)
            ttl: Time to live in seconds (uses settings.CACHE_TTL if not specified)
        
        Returns:
            True if set successfully, False otherwise
        """
        if not self.redis:
            return False
        
        try:
            # Serialize to JSON
            serialized_value = json.dumps(value)
            
            # Set with TTL
            ttl = ttl or settings.CACHE_TTL
            await self.redis.setex(key, ttl, serialized_value)
            
            return True
            
        except (TypeError, ValueError) as e:
            logger.error(f"Failed to serialize value for key '{key}': {e}")
            return False
        except Exception as e:
            logger.error(f"Redis set error for key '{key}': {e}")
            return False
    
    async def delete(self, key: str) -> bool:
        """
        Delete key from cache.
        
        Args:
            key: Cache key to delete
        
        Returns:
            True if deleted, False otherwise
        """
        if not self.redis:
            return False
        
        try:
            await self.redis.delete(key)
            return True
        except Exception as e:
            logger.error(f"Redis delete error for key '{key}': {e}")
            return False
    
    async def exists(self, key: str) -> bool:
        """
        Check if key exists in cache.
        
        Args:
            key: Cache key
        
        Returns:
            True if key exists, False otherwise
        """
        if not self.redis:
            return False
        
        try:
            result = await self.redis.exists(key)
            return bool(result)
        except Exception as e:
            logger.error(f"Redis exists error for key '{key}': {e}")
            return False
    
    async def get_ttl(self, key: str) -> Optional[int]:
        """
        Get remaining TTL for a key.
        
        Args:
            key: Cache key
        
        Returns:
            Remaining TTL in seconds, or None if key doesn't exist or has no TTL
        """
        if not self.redis:
            return None
        
        try:
            ttl = await self.redis.ttl(key)
            return ttl if ttl > 0 else None
        except Exception as e:
            logger.error(f"Redis TTL error for key '{key}': {e}")
            return None
    
    async def increment(self, key: str, amount: int = 1) -> Optional[int]:
        """
        Increment a counter in cache.
        
        Args:
            key: Cache key
            amount: Amount to increment by
        
        Returns:
            New value after increment, or None on error
        """
        if not self.redis:
            return None
        
        try:
            return await self.redis.incrby(key, amount)
        except Exception as e:
            logger.error(f"Redis increment error for key '{key}': {e}")
            return None
    
    async def decrement(self, key: str, amount: int = 1) -> Optional[int]:
        """
        Decrement a counter in cache.
        
        Args:
            key: Cache key
            amount: Amount to decrement by
        
        Returns:
            New value after decrement, or None on error
        """
        if not self.redis:
            return None
        
        try:
            return await self.redis.decrby(key, amount)
        except Exception as e:
            logger.error(f"Redis decrement error for key '{key}': {e}")
            return None
    
    async def get_many(self, keys: list[str]) -> dict[str, Any]:
        """
        Get multiple values at once.
        
        Args:
            keys: List of cache keys
        
        Returns:
            Dictionary mapping keys to values (missing keys are omitted)
        """
        if not self.redis or not keys:
            return {}
        
        try:
            values = await self.redis.mget(keys)
            result = {}
            
            for key, value in zip(keys, values):
                if value is not None:
                    try:
                        result[key] = json.loads(value)
                    except json.JSONDecodeError:
                        logger.warning(f"Failed to decode value for key '{key}'")
            
            return result
            
        except Exception as e:
            logger.error(f"Redis mget error: {e}")
            return {}
    
    async def set_many(
        self,
        mapping: dict[str, Any],
        ttl: Optional[int] = None
    ) -> bool:
        """
        Set multiple key-value pairs at once.
        
        Args:
            mapping: Dictionary of key-value pairs
            ttl: Time to live for all keys
        
        Returns:
            True if all set successfully, False otherwise
        """
        if not self.redis or not mapping:
            return False
        
        try:
            # Use pipeline for atomic operation
            async with self.redis.pipeline() as pipe:
                ttl = ttl or settings.CACHE_TTL
                
                for key, value in mapping.items():
                    serialized = json.dumps(value)
                    pipe.setex(key, ttl, serialized)
                
                await pipe.execute()
            
            return True
            
        except Exception as e:
            logger.error(f"Redis mset error: {e}")
            return False
    
    async def clear_pattern(self, pattern: str) -> int:
        """
        Delete all keys matching a pattern.
        
        Args:
            pattern: Redis key pattern (e.g., "user:*", "cache:insights:*")
        
        Returns:
            Number of keys deleted
        """
        if not self.redis:
            return 0
        
        try:
            keys = []
            async for key in self.redis.scan_iter(match=pattern):
                keys.append(key)
            
            if keys:
                await self.redis.delete(*keys)
            
            logger.info(f"Cleared {len(keys)} keys matching pattern '{pattern}'")
            return len(keys)
            
        except Exception as e:
            logger.error(f"Redis clear pattern error for '{pattern}': {e}")
            return 0
    
    async def flush_all(self) -> bool:
        """
        Clear all keys in the database. Use with caution!
        
        Returns:
            True if successful, False otherwise
        """
        if not self.redis:
            return False
        
        try:
            await self.redis.flushdb()
            logger.warning("Redis cache flushed (all keys deleted)")
            return True
        except Exception as e:
            logger.error(f"Redis flush error: {e}")
            return False
    
    async def get_info(self) -> dict:
        """
        Get Redis server information.
        
        Returns:
            Dictionary with Redis stats or empty dict on error
        """
        if not self.redis:
            return {}
        
        try:
            info = await self.redis.info()
            return {
                "used_memory_human": info.get("used_memory_human"),
                "connected_clients": info.get("connected_clients"),
                "total_commands_processed": info.get("total_commands_processed"),
                "keyspace_hits": info.get("keyspace_hits", 0),
                "keyspace_misses": info.get("keyspace_misses", 0),
            }
        except Exception as e:
            logger.error(f"Redis info error: {e}")
            return {}
    
    async def close(self):
        """Close Redis connection and cleanup."""
        if self.redis:
            try:
                await self.redis.close()
                logger.info("Redis connection closed")
            except Exception as e:
                logger.error(f"Error closing Redis connection: {e}")
            finally:
                self.redis = None
        
        if self._connection_pool:
            try:
                await self._connection_pool.disconnect()
            except Exception as e:
                logger.error(f"Error closing Redis connection pool: {e}")
            finally:
                self._connection_pool = None
    
    @property
    def is_connected(self) -> bool:
        """Check if Redis is connected."""
        return self.redis is not None


# === Global Redis Instance ===
redis_cache = RedisCache()


# === Helper Functions ===
async def get_cached_or_compute(
    key: str,
    compute_func: callable,
    ttl: Optional[int] = None
) -> Any:
    """
    Get value from cache or compute and cache it.
    
    Args:
        key: Cache key
        compute_func: Async function to compute value if not cached
        ttl: Cache TTL in seconds
    
    Returns:
        Cached or computed value
    """
    # Try cache first
    cached = await redis_cache.get(key)
    if cached is not None:
        logger.debug(f"Cache hit: {key}")
        return cached
    
    # Compute value
    logger.debug(f"Cache miss: {key}")
    value = await compute_func()
    
    # Cache result
    await redis_cache.set(key, value, ttl=ttl)
    
    return value


# === Cache Key Generators ===
def make_cache_key(prefix: str, *args, **kwargs) -> str:
    """
    Generate a consistent cache key.
    
    Args:
        prefix: Key prefix (e.g., "insights", "web3")
        *args: Positional arguments to include in key
        **kwargs: Keyword arguments to include in key
    
    Returns:
        Cache key string
    
    Example:
        >>> make_cache_key("insights", "BTC", depth="deep")
        "tovira:insights:BTC:depth=deep"
    """
    import hashlib
    
    parts = [f"tovira:{prefix}"]
    
    # Add positional args
    for arg in args:
        parts.append(str(arg))
    
    # Add sorted kwargs
    for k, v in sorted(kwargs.items()):
        parts.append(f"{k}={v}")
    
    key = ":".join(parts)
    
    # If key is too long, hash it
    if len(key) > 200:
        hash_suffix = hashlib.md5(key.encode()).hexdigest()[:16]
        key = f"{parts[0]}:hash:{hash_suffix}"
    
    return key


# === Cache Decorators ===
def cached(ttl: Optional[int] = None, key_prefix: str = "func"):
    """
    Decorator to cache async function results.
    
    Args:
        ttl: Cache TTL in seconds
        key_prefix: Prefix for cache key
    
    Example:
        @cached(ttl=300, key_prefix="insights")
        async def get_market_data(symbol: str):
            return await fetch_data(symbol)
    """
    def decorator(func):
        async def wrapper(*args, **kwargs):
            # Generate cache key from function name and args
            cache_key = make_cache_key(key_prefix, func.__name__, *args, **kwargs)
            
            # Try cache
            cached_value = await redis_cache.get(cache_key)
            if cached_value is not None:
                logger.debug(f"Cache hit for {func.__name__}")
                return cached_value
            
            # Compute and cache
            result = await func(*args, **kwargs)
            await redis_cache.set(cache_key, result, ttl=ttl)
            
            return result
        
        return wrapper
    return decorator


# === Usage Examples ===
"""
# Example 1: Simple get/set
await redis_cache.set("user:123:preferences", {"theme": "dark"}, ttl=3600)
prefs = await redis_cache.get("user:123:preferences")

# Example 2: Batch operations
await redis_cache.set_many({
    "token:BTC:price": 45000,
    "token:ETH:price": 2500,
}, ttl=60)
prices = await redis_cache.get_many(["token:BTC:price", "token:ETH:price"])

# Example 3: Counter
await redis_cache.increment("api:requests:today")
count = await redis_cache.get("api:requests:today")

# Example 4: Pattern deletion
await redis_cache.clear_pattern("insights:BTC:*")

# Example 5: Cache-or-compute pattern
async def fetch_token_data(symbol):
    # Expensive operation
    return await external_api.get_token(symbol)

data = await get_cached_or_compute(
    key=f"token:{symbol}:data",
    compute_func=lambda: fetch_token_data(symbol),
    ttl=300
)

# Example 6: Decorator
@cached(ttl=600, key_prefix="web3")
async def get_protocol_info(protocol_name: str):
    return await fetch_protocol_data(protocol_name)

# Automatically cached for 10 minutes
info = await get_protocol_info("uniswap")
"""