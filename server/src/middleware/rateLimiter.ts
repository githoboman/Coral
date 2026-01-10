import { createClient } from 'redis';
import { Request, Response, NextFunction } from 'express';

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redisClient.on('error', (err: Error) => console.error('Redis Client Error:', err));
redisClient.on('connect', () => console.log('Redis Client Connected'));

// Connect to Redis
redisClient.connect().catch(console.error);

const LIMIT = 4;
const WINDOW_SECONDS = 6 * 60 * 60; // 6 hours

export async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
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
