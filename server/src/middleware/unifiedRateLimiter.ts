// server/src/middleware/unifiedRateLimiter.ts
import { Request, Response, NextFunction } from "express";
import { getSubscriptionService } from "../services/subscriptionService";

/**
 * Unified Rate Limiter
 * - Free users: 2 messages/day
 * - Premium users: 5 messages/day
 * - Resets at midnight UTC
 * - Applies to ALL chat messages
 */
export async function unifiedRateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.body.user_id;

  if (!userId) {
    return next();
  }

  // Validate user_id format
  if (!userId.startsWith("0x") || userId.length !== 66) {
    return next();
  }

  try {
    const subscriptionService = getSubscriptionService();

    // Check if user can send message
    const canUse = await subscriptionService.canUsePrompt(userId);

    if (!canUse) {
      const stats = await subscriptionService.getPromptsRemaining(userId);

      if (stats.tier === 0) {
        // Free user hit limit - require payment
        res.status(402).json({
          error: "Daily Limit Reached",
          message: `You've used your ${stats.limit} free messages today. Upgrade to Premium for ${stats.limit === 2 ? "5" : stats.limit} messages/day!`,
          upgrade_required: true,
          subscription_price: "2 SUI",
          current_tier: "free",
          limit: stats.limit,
          used: stats.used,
          remaining: 0,
          reset_at: "midnight UTC",
        });
      } else {
        // Premium user hit limit
        res.status(429).json({
          error: "Daily limit reached",
          message: `You've used all ${stats.limit} premium messages today. Resets at midnight UTC.`,
          tier: "premium",
          limit: stats.limit,
          used: stats.used,
          remaining: 0,
          reset_at: "midnight UTC",
        });
      }
    }

    // Track usage AFTER successful message send (not before)
    // We'll track this in the chat route after the response is generated
    (req as any).shouldTrackUsage = true;

    next();
  } catch (error) {
    console.error("[UNIFIED RATE LIMIT] Error:", error);
    // Fail open - allow request to proceed
    next();
  }
}

/**
 * Middleware to track usage AFTER successful message
 * Call this after the LLM response is generated
 */
export async function trackMessageUsage(userId: string): Promise<void> {
  try {
    const subscriptionService = getSubscriptionService();
    await subscriptionService.trackPromptUsage(userId);
    console.log(`[UNIFIED RATE LIMIT] Tracked usage for ${userId}`);
  } catch (error) {
    console.error("[UNIFIED RATE LIMIT] Failed to track usage:", error);
  }
}
