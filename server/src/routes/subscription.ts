import { Router, Request, Response, NextFunction } from "express";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
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
 * Get subscription status for a wallet address
 * GET /api/subscription/status?wallet_address=0x...
 */
router.get(
  "/status",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { wallet_address } = req.query;

      console.log("📥 Subscription status request for:", wallet_address);

      if (!wallet_address || typeof wallet_address !== "string") {
        return res.status(400).json({
          error: "Bad Request",
          detail: "Wallet address is required",
        });
      }

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

      const client = getSuiClient();

      try {
        // Build transaction using Transaction class like in TicketMinter
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

        console.log("📊 DevInspect result:", {
          status: result.effects.status,
          hasResults: !!result.results?.[0],
        });

        // Parse the return values if successful
        if (
          result.effects.status.status === "success" &&
          result.results?.[0]?.returnValues &&
          result.results[0].returnValues.length >= 5
        ) {
          const [
            tierBytes,
            startedAtBytes,
            expiresAtBytes,
            promptsUsedBytes,
            lastPromptDateBytes,
          ] = result.results[0].returnValues;

          const tier = new DataView(
            new Uint8Array(tierBytes[0]).buffer,
          ).getUint8(0);
          const startedAt = Number(
            new DataView(new Uint8Array(startedAtBytes[0]).buffer).getBigUint64(
              0,
              true,
            ),
          );
          const expiresAt = Number(
            new DataView(new Uint8Array(expiresAtBytes[0]).buffer).getBigUint64(
              0,
              true,
            ),
          );
          const dailyPromptsUsed = Number(
            new DataView(
              new Uint8Array(promptsUsedBytes[0]).buffer,
            ).getBigUint64(0, true),
          );
          const lastPromptDate = Number(
            new DataView(
              new Uint8Array(lastPromptDateBytes[0]).buffer,
            ).getBigUint64(0, true),
          );

          const response = {
            wallet_address,
            tier,
            started_at: startedAt || null,
            expires_at: expiresAt || null,
            daily_prompts_used: dailyPromptsUsed,
            last_prompt_date: lastPromptDate || null,
            is_premium: tier === 1 && expiresAt > Date.now(),
          };

          console.log("✅ Subscription data:", response);
          return res.json(response);
        }

        // If execution failed or no data, return default free tier
        console.log("⚠️ No subscription found, returning free tier");
        return res.json({
          wallet_address,
          tier: 0,
          started_at: null,
          expires_at: null,
          daily_prompts_used: 0,
          last_prompt_date: null,
          is_premium: false,
        });
      } catch (inspectError: any) {
        console.error("❌ DevInspect error:", inspectError);

        // Return default free tier on any blockchain query error
        return res.json({
          wallet_address,
          tier: 0,
          started_at: null,
          expires_at: null,
          daily_prompts_used: 0,
          last_prompt_date: null,
          is_premium: false,
        });
      }
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
