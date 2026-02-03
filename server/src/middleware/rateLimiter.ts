import { createClient, RedisClientType } from 'redis';
import { Request, Response, NextFunction } from 'express';

const RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_ENABLED !== 'false';
const LIMIT = 4;
const WINDOW_SECONDS = 6 * 60 * 60; // 6 hours

let redisClient: RedisClientType | null = null;
let redisConnected = false;

// Only initialize Redis if rate limiting is enabled and URL is provided
if (RATE_LIMIT_ENABLED && process.env.REDIS_URL) {
  redisClient = createClient({
    url: process.env.REDIS_URL,
    socket: {
      connectTimeout: 10000,
      reconnectStrategy: (retries) => {
        // Stop retrying after 3 attempts
        if (retries > 3) {
          console.log('[RATE LIMIT] Redis connection failed after 3 retries, disabling rate limiting');
          return false; // Stop reconnecting
        }
        return Math.min(retries * 1000, 5000); // Wait before retry
      }
    }
  });

  redisClient.on('error', (err: Error) => {
    console.error('Redis Client Error:', err.message);
    redisConnected = false;
  });
  redisClient.on('connect', () => {
    console.log('Redis Client Connected');
    redisConnected = true;
  });
  redisClient.on('end', () => {
    console.log('Redis Client Disconnected');
    redisConnected = false;
  });

  // Connect to Redis (don't block on failure)
  redisClient.connect().catch((err) => {
    console.error('Redis connection failed:', err.message);
    redisConnected = false;
  });
} else {
  console.log('[RATE LIMIT] Rate limiting disabled via RATE_LIMIT_ENABLED=false');
}

export async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  // Skip rate limiting if disabled or Redis not connected
  if (!RATE_LIMIT_ENABLED || !redisConnected || !redisClient) {
    return next();
  }

  const userId = req.body.user_id;

  if (!userId) {
    return next();
  }

  const key = `ratelimit:${userId}`;

  try {
    // Get current count
    const current = await redisClient.get(key);
    const count = current ? parseInt(current) : 0;

    if (count >= LIMIT) {
      // Get TTL to show reset time
      const ttl = await redisClient.ttl(key);
      const resetMinutes = Math.ceil(ttl / 60);

      console.log(`[RATE LIMIT] User ${userId.substring(0, 10)}... blocked. Reset in ${resetMinutes} minutes.`);

      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: `You've reached the limit of ${LIMIT} messages per 6 hours. Try again in ${resetMinutes} minutes.`,
        limit: LIMIT,
        remaining: 0,
        resetIn: resetMinutes
      });
    }

    // Increment counter
    const newCount = await redisClient.incr(key);

    // Set expiration on first request
    if (newCount === 1) {
      await redisClient.expire(key, WINDOW_SECONDS);
    }

    console.log(`[RATE LIMIT] User ${userId.substring(0, 10)}... - ${newCount}/${LIMIT} messages used`);

    // Add headers
    res.setHeader('X-RateLimit-Limit', LIMIT.toString());
    res.setHeader('X-RateLimit-Remaining', (LIMIT - newCount).toString());

    next();
  } catch (error) {
    console.error('[RATE LIMIT] Redis error:', error);
    // On Redis error, allow request to proceed (fail open)
    next();
  }
}

export { redisClient };

