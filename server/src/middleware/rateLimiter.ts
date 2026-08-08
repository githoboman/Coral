import { createClient, RedisClientType } from "redis";
import { Request, Response, NextFunction } from "express";

const RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_ENABLED !== "false";
const LIMIT = 4;
const WINDOW_SECONDS = 6 * 60 * 60; // 6 hours (general agents only)

let redisClient: RedisClientType | null = null;
let redisConnected = false;

if (RATE_LIMIT_ENABLED && process.env.REDIS_URL) {
  redisClient = createClient({
    url: process.env.REDIS_URL,
    socket: {
      connectTimeout: 10000,
      reconnectStrategy: (retries) => {
        if (retries > 3) {
          console.log(
            "[RATE LIMIT] Redis connection failed after 3 retries, disabling rate limiting",
          );
          return false;
        }
        return Math.min(retries * 1000, 5000);
      },
    },
  });

  redisClient.on("error", (err: Error) => {
    console.error("Redis Client Error:", err.message);
    redisConnected = false;
  });
  redisClient.on("connect", () => {
    console.log("Redis Client Connected");
    redisConnected = true;
  });
  redisClient.on("end", () => {
    console.log("Redis Client Disconnected");
    redisConnected = false;
  });

  redisClient.connect().catch((err) => {
    console.error("Redis connection failed:", err.message);
    redisConnected = false;
  });
} else {
  console.log(
    "[RATE LIMIT] Rate limiting disabled via RATE_LIMIT_ENABLED=false",
  );
}

export async function rateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // ✅ FIX: task_agent has its own subscription-based daily limits (2 free / 5 premium)
  // handled in chat.ts — skip the 6-hour general limiter entirely for it
  const agentId = req.body.agent_id || req.body.agentId;
  if (agentId === "task_agent" || agentId === "task") {
    return next();
  }

  if (!RATE_LIMIT_ENABLED || !redisConnected || !redisClient) {
    return next();
  }

  const userId = req.body.user_id;
  if (!userId) {
    return next();
  }

  const key = `ratelimit:${userId}`;

  try {
    const current = await redisClient.get(key);
    const count = current ? parseInt(current) : 0;

    if (count >= LIMIT) {
      const ttl = await redisClient.ttl(key);
      const resetMinutes = Math.ceil(ttl / 60);
      console.log(
        `[RATE LIMIT] User ${userId.substring(0, 10)}... blocked. Reset in ${resetMinutes} minutes.`,
      );
      return res.status(429).json({
        error: "Rate limit exceeded",
        message: `You've reached the limit of ${LIMIT} messages per 6 hours. Try again in ${resetMinutes} minutes.`,
        limit: LIMIT,
        remaining: 0,
        resetIn: resetMinutes,
      });
    }

    const newCount = await redisClient.incr(key);
    if (newCount === 1) {
      await redisClient.expire(key, WINDOW_SECONDS);
    }

    console.log(
      `[RATE LIMIT] User ${userId.substring(0, 10)}... - ${newCount}/${LIMIT} messages used`,
    );
    res.setHeader("X-RateLimit-Limit", LIMIT.toString());
    res.setHeader("X-RateLimit-Remaining", (LIMIT - newCount).toString());
    next();
  } catch (error) {
    console.error("[RATE LIMIT] Redis error:", error);
    next();
  }
}

export { redisClient };
