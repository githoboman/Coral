// server/src/services/subscriptionService.ts
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { TicketMinter } from "./ticketMinter";
import { WalrusUserManager } from "./walrusUserManager";
import { redisClient } from "../middleware/rateLimiter";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export class SubscriptionService {
  private client: SuiClient;
  private packageId: string;
  private subscriptionRegistryId: string;

  constructor() {
    const network = process.env.SUI_NETWORK || "testnet";
    this.client = new SuiClient({
      url: getFullnodeUrl(network as "testnet" | "mainnet"),
    });

    this.packageId = process.env.SUI_PACKAGE_ID || "";
    this.subscriptionRegistryId =
      process.env.SUI_SUBSCRIPTION_REGISTRY_ID || "";

    console.log("✅ SubscriptionService initialized");
  }

  // Get today's date as ISO string (YYYY-MM-DD)
  private getTodayDate(): string {
    return new Date().toISOString().split("T")[0];
  }

  // Check if user needs daily reset
  private needsDailyReset(lastDate: string | undefined): boolean {
    if (!lastDate) return true;
    return lastDate !== this.getTodayDate();
  }

  // Get subscription details from on-chain
  async getOnChainSubscription(walletAddress: string): Promise<{
    tier: number;
    started_at: number;
    expires_at: number;
    daily_prompts_used: number;
    last_prompt_date: number;
  } | null> {
    try {
      const tx = new Transaction();

      tx.moveCall({
        target: `${this.packageId}::subscriptions::get_subscription`,
        arguments: [
          tx.object(this.subscriptionRegistryId),
          tx.pure.address(walletAddress),
        ],
      });

      const result = await this.client.devInspectTransactionBlock({
        sender: walletAddress,
        transactionBlock: tx,
      });

      if (result.results?.[0]?.returnValues) {
        const values = result.results[0].returnValues;

        // Parse the tuple: (tier, started_at, expires_at, daily_prompts_used, last_prompt_date)
        const tier = this.parseU8(values[0][0]);
        const started_at = this.parseU64(values[1][0]);
        const expires_at = this.parseU64(values[2][0]);
        const daily_prompts_used = this.parseU64(values[3][0]);
        const last_prompt_date = this.parseU64(values[4][0]);

        return {
          tier,
          started_at: Number(started_at),
          expires_at: Number(expires_at),
          daily_prompts_used: Number(daily_prompts_used),
          last_prompt_date: Number(last_prompt_date),
        };
      }

      return null;
    } catch (error) {
      console.error("Error getting on-chain subscription:", error);
      return null;
    }
  }

  // Get subscription from Walrus (fast cache)
  async getWalrusSubscription(walletAddress: string): Promise<{
    tier: number;
    expires_at?: string;
    daily_prompts_used: number;
    last_prompt_date?: string;
  } | null> {
    try {
      const ticketMinter = new TicketMinter();
      const userRegistryBlobId = await ticketMinter.getCurrentBlobId();

      if (!userRegistryBlobId) return null;

      const userManager = new WalrusUserManager();
      const profile = await userManager.getUserProfile(
        userRegistryBlobId,
        walletAddress,
      );

      if (!profile) return null;

      return {
        tier: profile.subscription_tier || 0,
        expires_at: profile.subscription_expires_at,
        daily_prompts_used: profile.daily_prompts_used || 0,
        last_prompt_date: profile.last_prompt_date,
      };
    } catch (error) {
      console.error("Error getting Walrus subscription:", error);
      return null;
    }
  }

  // Update Walrus subscription cache
  async updateWalrusSubscription(
    walletAddress: string,
    updates: {
      tier?: number;
      expires_at?: string;
      daily_prompts_used?: number;
      last_prompt_date?: string;
    },
  ): Promise<boolean> {
    try {
      const ticketMinter = new TicketMinter();
      const userRegistryBlobId = await ticketMinter.getCurrentBlobId();

      if (!userRegistryBlobId) return false;

      const userManager = new WalrusUserManager();
      const profile = await userManager.getUserProfile(
        userRegistryBlobId,
        walletAddress,
      );

      if (!profile) return false;

      // Update profile
      const updatedProfile = userManager.createUserProfile(
        profile.email,
        profile.wallet_address,
        profile.is_waitlisted,
        profile.points_awarded,
        {
          username: profile.username,
          first_name: profile.first_name,
          last_name: profile.last_name,
          preferences: profile.preferences,
          waitlist_verified_at: profile.waitlist_verified_at,
          chat_registry_blob_id: profile.chat_registry_blob_id,
          tasks_created_today: profile.tasks_created_today,
          tasks_claimed_today: profile.tasks_claimed_today,
          last_task_reset_date: profile.last_task_reset_date,
          subscription_tier:
            updates.tier !== undefined
              ? updates.tier
              : profile.subscription_tier,
          subscription_expires_at:
            updates.expires_at || profile.subscription_expires_at,
          daily_prompts_used:
            updates.daily_prompts_used !== undefined
              ? updates.daily_prompts_used
              : profile.daily_prompts_used,
          last_prompt_date:
            updates.last_prompt_date || profile.last_prompt_date,
        },
      );

      const newBlobId = await userManager.addOrUpdateUser(
        userRegistryBlobId,
        updatedProfile,
      );

      if (!newBlobId) return false;

      // Update on-chain registry if changed
      if (newBlobId !== userRegistryBlobId) {
        await ticketMinter.updateBlobRegistry(newBlobId);
      }

      return true;
    } catch (error) {
      console.error("Error updating Walrus subscription:", error);
      return false;
    }
  }

  // Check if user can use prompt (with Redis fast path)
  async canUsePrompt(walletAddress: string): Promise<boolean> {
    try {
      const today = this.getTodayDate();

      // Layer 1: Redis fast check
      if (redisClient && redisClient.isOpen) {
        const redisKey = `prompts:${walletAddress}:${today}`;
        const tierKey = `subscription:${walletAddress}`;

        try {
          const [count, tierData] = await Promise.all([
            redisClient.get(redisKey),
            redisClient.get(tierKey),
          ]);

          if (count && tierData) {
            const used = parseInt(count);
            const { tier, expires_at } = JSON.parse(tierData);

            // Check if premium expired
            const now = Date.now();
            const isActivePremium =
              tier === 1 && expires_at && new Date(expires_at).getTime() > now;

            const limit = isActivePremium ? 5 : 2;

            if (used < limit) {
              console.log(
                `[SUBSCRIPTION] Redis fast check: ${used}/${limit} used`,
              );
              return true;
            } else {
              console.log(
                `[SUBSCRIPTION] Redis fast check: Limit reached ${used}/${limit}`,
              );
              return false;
            }
          }
        } catch (redisError) {
          console.warn(
            "[SUBSCRIPTION] Redis check failed, falling back to Walrus",
          );
        }
      }

      // Layer 2: Walrus cache check
      const walrusData = await this.getWalrusSubscription(walletAddress);

      if (!walrusData) {
        // New user - allow first prompts
        return true;
      }

      // Check if needs daily reset
      if (this.needsDailyReset(walrusData.last_prompt_date)) {
        console.log(`[SUBSCRIPTION] Daily reset needed for ${walletAddress}`);
        return true;
      }

      // Check tier and expiration
      const now = Date.now();
      const isActivePremium =
        walrusData.tier === 1 &&
        walrusData.expires_at &&
        new Date(walrusData.expires_at).getTime() > now;

      const limit = isActivePremium ? 5 : 2;
      const canUse = walrusData.daily_prompts_used < limit;

      console.log(
        `[SUBSCRIPTION] Walrus check: ${walrusData.daily_prompts_used}/${limit} used, tier: ${walrusData.tier}`,
      );

      return canUse;
    } catch (error) {
      console.error("Error checking prompt limit:", error);
      return true; // Fail open
    }
  }

  // Track prompt usage
  async trackPromptUsage(walletAddress: string): Promise<boolean> {
    try {
      const today = this.getTodayDate();

      // Get current usage
      const walrusData = await this.getWalrusSubscription(walletAddress);

      // Determine if reset needed
      const needsReset = this.needsDailyReset(walrusData?.last_prompt_date);
      const currentUsed = needsReset ? 0 : walrusData?.daily_prompts_used || 0;
      const newUsed = currentUsed + 1;

      // Update Walrus
      await this.updateWalrusSubscription(walletAddress, {
        daily_prompts_used: newUsed,
        last_prompt_date: today,
      });

      // Update Redis cache
      if (redisClient && redisClient.isOpen) {
        const redisKey = `prompts:${walletAddress}:${today}`;

        await redisClient.set(redisKey, newUsed.toString(), {
          EX: 86400, // Expire after 24 hours
        });

        // Cache subscription tier for fast checks
        if (walrusData) {
          const tierKey = `subscription:${walletAddress}`;
          await redisClient.set(
            tierKey,
            JSON.stringify({
              tier: walrusData.tier,
              expires_at: walrusData.expires_at,
            }),
            { EX: 3600 }, // Expire after 1 hour
          );
        }
      }

      console.log(
        `[SUBSCRIPTION] Tracked usage: ${newUsed} prompts for ${walletAddress}`,
      );

      return true;
    } catch (error) {
      console.error("Error tracking prompt usage:", error);
      return false;
    }
  }

  // Get prompts remaining
  async getPromptsRemaining(walletAddress: string): Promise<{
    used: number;
    limit: number;
    remaining: number;
    tier: number;
  }> {
    try {
      const walrusData = await this.getWalrusSubscription(walletAddress);

      if (!walrusData) {
        return { used: 0, limit: 2, remaining: 2, tier: 0 };
      }

      // Check if needs daily reset
      const needsReset = this.needsDailyReset(walrusData.last_prompt_date);
      const used = needsReset ? 0 : walrusData.daily_prompts_used;

      // Check tier and expiration
      const now = Date.now();
      const isActivePremium =
        walrusData.tier === 1 &&
        walrusData.expires_at &&
        new Date(walrusData.expires_at).getTime() > now;

      const tier = isActivePremium ? 1 : 0;
      const limit = isActivePremium ? 5 : 2;

      return {
        used,
        limit,
        remaining: Math.max(0, limit - used),
        tier,
      };
    } catch (error) {
      console.error("Error getting prompts remaining:", error);
      return { used: 0, limit: 2, remaining: 2, tier: 0 };
    }
  }

  // Helper to parse u8 from bytes
  private parseU8(bytes: number[]): number {
    return bytes[0];
  }

  // Helper to parse u64 from bytes
  private parseU64(bytes: number[]): bigint {
    const view = new DataView(new Uint8Array(bytes).buffer);
    return view.getBigUint64(0, true);
  }
}

// Singleton
let subscriptionService: SubscriptionService | null = null;

export function getSubscriptionService(): SubscriptionService {
  if (!subscriptionService) {
    subscriptionService = new SubscriptionService();
  }
  return subscriptionService;
}
