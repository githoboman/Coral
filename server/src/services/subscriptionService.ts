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

  private getTodayDate(): string {
    return new Date().toISOString().split("T")[0];
  }

  private needsDailyReset(lastDate: string | undefined): boolean {
    if (!lastDate) return true;
    return lastDate !== this.getTodayDate();
  }

  async getCurrentTier(walletAddress: string): Promise<{
    tier: number;
    expires_at: number;
    isActivePremium: boolean;
  }> {
    try {
      const onChain = await this.getOnChainSubscription(walletAddress);

      if (onChain) {
        const now = Date.now();
        const isActivePremium = onChain.tier === 1 && onChain.expires_at > now;

        console.log(
          `[SUBSCRIPTION] On-chain tier check for ${walletAddress.substring(0, 10)}...:`,
        );
        console.log(`   Tier: ${onChain.tier}`);
        console.log(
          `   Expires: ${new Date(onChain.expires_at).toISOString()}`,
        );
        console.log(`   Active Premium: ${isActivePremium}`);

        return {
          tier: isActivePremium ? 1 : 0,
          expires_at: onChain.expires_at,
          isActivePremium,
        };
      }

      console.warn(
        `[SUBSCRIPTION] On-chain check failed, trying Walrus fallback...`,
      );
      const walrusData = await this.getWalrusSubscription(walletAddress);

      if (walrusData) {
        const now = Date.now();
        // ✅ FIX: Ensure boolean type
        const isActivePremium = Boolean(
          walrusData.tier === 1 &&
          walrusData.expires_at &&
          new Date(walrusData.expires_at).getTime() > now,
        );

        return {
          tier: isActivePremium ? 1 : 0,
          expires_at: walrusData.expires_at
            ? new Date(walrusData.expires_at).getTime()
            : 0,
          isActivePremium,
        };
      }

      console.log(
        `[SUBSCRIPTION] No subscription found, defaulting to free tier`,
      );
      return { tier: 0, expires_at: 0, isActivePremium: false };
    } catch (error) {
      console.error("[SUBSCRIPTION] Error getting tier:", error);
      return { tier: 0, expires_at: 0, isActivePremium: false };
    }
  }

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

      if (
        result.results?.[0]?.returnValues &&
        result.results[0].returnValues.length >= 5
      ) {
        const values = result.results[0].returnValues;

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
          telegram_chat_id: profile.telegram_chat_id,
          telegram_username: profile.telegram_username,
          telegram_linked_at: profile.telegram_linked_at,
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

  async canUsePrompt(walletAddress: string): Promise<boolean> {
    try {
      const today = this.getTodayDate();

      // Get current tier from blockchain (source of truth)
      const tierStatus = await this.getCurrentTier(walletAddress);
      const limit = tierStatus.isActivePremium ? 5 : 2;

      console.log(
        `[SUBSCRIPTION] Checking canUsePrompt for ${walletAddress.substring(0, 10)}...`,
      );
      console.log(`   Tier: ${tierStatus.tier}, Limit: ${limit}`);

      // Layer 1: Redis fast check
      if (redisClient && redisClient.isOpen) {
        const redisKey = `prompts:${walletAddress}:${today}`;

        try {
          const count = await redisClient.get(redisKey);
          console.log(`   Redis key: ${redisKey}, value: ${count}`);

          if (count) {
            const used = parseInt(count);

            if (used < limit) {
              console.log(
                `[SUBSCRIPTION] ✅ Redis: ALLOWED ${used}/${limit} (tier ${tierStatus.tier})`,
              );
              return true;
            } else {
              console.log(
                `[SUBSCRIPTION] ❌ Redis: BLOCKED ${used}/${limit} (tier ${tierStatus.tier})`,
              );
              return false;
            }
          } else {
            // No Redis data - new user or daily reset happened
            console.log(
              `[SUBSCRIPTION] ✅ Redis: No data found, allowing (new user or reset)`,
            );
            return true;
          }
        } catch (redisError) {
          console.warn(
            "[SUBSCRIPTION] Redis check failed, falling back to Walrus",
            redisError,
          );
        }
      }

      // Layer 2: Walrus cache check
      const walrusData = await this.getWalrusSubscription(walletAddress);

      if (!walrusData) {
        // New user - allow first prompts
        console.log(`[SUBSCRIPTION] ✅ Walrus: No data, allowing (new user)`);
        return true;
      }

      console.log(
        `   Walrus data: used=${walrusData.daily_prompts_used}, last_date=${walrusData.last_prompt_date}`,
      );

      // Check if needs daily reset
      if (this.needsDailyReset(walrusData.last_prompt_date)) {
        console.log(`[SUBSCRIPTION] ✅ Walrus: Daily reset needed, allowing`);
        return true;
      }

      const canUse = walrusData.daily_prompts_used < limit;

      console.log(
        `[SUBSCRIPTION] ${canUse ? "✅" : "❌"} Walrus: ${walrusData.daily_prompts_used}/${limit} (blockchain tier: ${tierStatus.tier}, cached: ${walrusData.tier})`,
      );

      return canUse;
    } catch (error) {
      console.error("Error checking prompt limit:", error);
      return true;
    }
  }

  async trackPromptUsage(walletAddress: string): Promise<boolean> {
    try {
      const today = this.getTodayDate();

      console.log(
        `\n[SUBSCRIPTION] 📊 Tracking prompt usage for ${walletAddress.substring(0, 10)}...`,
      );

      const tierStatus = await this.getCurrentTier(walletAddress);

      const walrusData = await this.getWalrusSubscription(walletAddress);

      const needsReset = this.needsDailyReset(walrusData?.last_prompt_date);
      const currentUsed = needsReset ? 0 : walrusData?.daily_prompts_used || 0;
      const newUsed = currentUsed + 1;

      console.log(
        `   Current: ${currentUsed}, New: ${newUsed}, Reset: ${needsReset}`,
      );

      await this.updateWalrusSubscription(walletAddress, {
        tier: tierStatus.tier,
        expires_at:
          tierStatus.expires_at > 0
            ? new Date(tierStatus.expires_at).toISOString()
            : undefined,
        daily_prompts_used: newUsed,
        last_prompt_date: today,
      });

      if (redisClient && redisClient.isOpen) {
        const redisKey = `prompts:${walletAddress}:${today}`;

        await redisClient.set(redisKey, newUsed.toString(), {
          EX: 86400,
        });

        console.log(`   Redis updated: ${redisKey} = ${newUsed}`);
      }

      console.log(
        `✅ [SUBSCRIPTION] Tracked: ${newUsed} prompts (tier ${tierStatus.tier})`,
      );

      return true;
    } catch (error) {
      console.error("Error tracking prompt usage:", error);
      return false;
    }
  }

  async getPromptsRemaining(walletAddress: string): Promise<{
    used: number;
    limit: number;
    remaining: number;
    tier: number;
  }> {
    try {
      const tierStatus = await this.getCurrentTier(walletAddress);
      const limit = tierStatus.isActivePremium ? 5 : 2;

      const walrusData = await this.getWalrusSubscription(walletAddress);

      if (!walrusData) {
        return { used: 0, limit, remaining: limit, tier: tierStatus.tier };
      }

      const needsReset = this.needsDailyReset(walrusData.last_prompt_date);
      const used = needsReset ? 0 : walrusData.daily_prompts_used;

      return {
        used,
        limit,
        remaining: Math.max(0, limit - used),
        tier: tierStatus.tier,
      };
    } catch (error) {
      console.error("Error getting prompts remaining:", error);
      return { used: 0, limit: 2, remaining: 2, tier: 0 };
    }
  }

  private parseU8(bytes: number[]): number {
    return bytes[0];
  }

  private parseU64(bytes: number[]): bigint {
    const view = new DataView(new Uint8Array(bytes).buffer);
    return view.getBigUint64(0, true);
  }
}

let subscriptionService: SubscriptionService | null = null;

export function getSubscriptionService(): SubscriptionService {
  if (!subscriptionService) {
    subscriptionService = new SubscriptionService();
  }
  return subscriptionService;
}
