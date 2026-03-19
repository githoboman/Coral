import { Router, Request, Response, NextFunction } from "express";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { getSubscriptionService } from "../services/subscriptionService";
import { requireAuth, AuthRequest } from "../middleware/auth";
import "dotenv/config";


const router = Router();

const PACKAGE_ID = process.env.SUI_PACKAGE_ID || "";
const SUBSCRIPTION_REGISTRY = process.env.SUI_SUBSCRIPTION_REGISTRY_ID || "";
const network = (process.env.SUI_NETWORK || "testnet") as "testnet" | "mainnet";

let suiClient: SuiClient | null = null;

function getSuiClient(): SuiClient {
  if (!suiClient) {
    suiClient = new SuiClient({ url: getFullnodeUrl(network) });
  }
  return suiClient;
}

/**
 * Get subscription status for the authenticated wallet address
 * GET /api/subscription/status
 */
router.get(
  "/status",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // Use JWT wallet address — no longer exposed to query param spoofing
      const wallet_address = req.user!.wallet_address;

      console.log("📥 Subscription status request for:", wallet_address);


      if (!PACKAGE_ID || !SUBSCRIPTION_REGISTRY) {
        console.error("❌ Missing environment variables:", {
          PACKAGE_ID: !!PACKAGE_ID,
          SUBSCRIPTION_REGISTRY: !!SUBSCRIPTION_REGISTRY,
        });
        return res.status(500).json({
          error: "Server Configuration Error",
          detail: "Subscription system not configured",
        });
      }

      const subscriptionService = getSubscriptionService();

      // Force refresh to get latest data from chain AND update the cache for other services (like chat)
      const data = await subscriptionService.getCurrentTier(wallet_address, true);

      // Get additional usage stats (using same service to be consistent)
      // Note: SubscriptionService return values slightly differ from raw chain data, 
      // but we can augment if needed. For now, we map what we have.

      // We need to fetch the full on-chain object to get usage stats if not in the simplified return
      // actually getCurrentTier returns simplified data. 
      // Let's expose a method in SubscriptionService to get full details or just use getOnChainSubscription directly
      // but we want to update cache.

      // Better approach: Use getOnChainSubscription directly here for full stats, 
      // BUT manually update the service's cache.
      const fullSub = await subscriptionService.getOnChainSubscription(wallet_address);
      const walrusSub = await subscriptionService.getSupabaseSubscription(wallet_address);

      // Manually inject into cache so Chat Agent sees it
      if (fullSub) {
        const isActivePremium = fullSub.tier === 1 && fullSub.expires_at > Date.now();
        // Update private cache via public method if we had one, or just rely on the fact 
        // that we can call getCurrentTier(..., true) which internally calls getOnChainSubscription
        // The issue is getCurrentTier returns a smaller subset of data.
      }

      // Let's just call using the service to ensure cache is hot.
      const tierStatus = await subscriptionService.getCurrentTier(wallet_address, true);

      // We might miss 'daily_prompts_used' from getCurrentTier Return.
      // Let's rely on getPromptsRemaining for usage stats.
      const usage = await subscriptionService.getPromptsRemaining(wallet_address);

      const response = {
        wallet_address,
        tier: tierStatus.tier,
        started_at: null, // Simplified, maybe correct later if needed
        expires_at: tierStatus.expires_at,
        daily_prompts_used: usage.used,
        last_prompt_date: null,
        is_premium: tierStatus.isActivePremium,
      };

      console.log("✅ Subscription data (refreshed):", response);
      return res.json(response);

    } catch (error: any) {
      console.error("❌ Subscription status error:", error);
      next(error);
    }
  },
);

/**
 * Verify if a wallet can use a premium feature
 * GET /api/subscription/verify?wallet_address=0x...
 */
router.get(
  "/verify",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { wallet_address } = req.query;

      if (!wallet_address || typeof wallet_address !== "string") {
        return res.status(400).json({
          error: "Bad Request",
          detail: "Wallet address is required",
        });
      }

      if (!PACKAGE_ID || !SUBSCRIPTION_REGISTRY) {
        return res.json({
          can_use_premium: false,
          reason: "Subscription system not configured",
        });
      }

      const client = getSuiClient();

      try {
        const tx = new Transaction();

        tx.moveCall({
          target: `${PACKAGE_ID}::subscriptions::get_subscription`,
          arguments: [
            tx.object(SUBSCRIPTION_REGISTRY),
            tx.pure.address(wallet_address),
          ],
        });

        const result = await client.devInspectTransactionBlock({
          sender: wallet_address,
          transactionBlock: tx,
        });

        if (
          result.effects.status.status === "success" &&
          result.results?.[0]?.returnValues &&
          result.results[0].returnValues.length >= 3
        ) {
          const [tierBytes, , expiresAtBytes] = result.results[0].returnValues;

          const tier = new DataView(
            new Uint8Array(tierBytes[0]).buffer,
          ).getUint8(0);
          const expiresAt = Number(
            new DataView(new Uint8Array(expiresAtBytes[0]).buffer).getBigUint64(
              0,
              true,
            ),
          );

          const isPremium = tier === 1 && expiresAt > Date.now();

          return res.json({
            can_use_premium: isPremium,
            reason: isPremium
              ? "Active premium subscription"
              : "No active premium subscription",
            expires_at: expiresAt || null,
          });
        }
      } catch (inspectError) {
        console.error("❌ Verify inspect error:", inspectError);
      }

      return res.json({
        can_use_premium: false,
        reason: "No subscription found",
      });
    } catch (error) {
      console.error("❌ Subscription verify error:", error);
      next(error);
    }
  },
);

export default router;
