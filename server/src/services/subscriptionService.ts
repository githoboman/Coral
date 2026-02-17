// server/src/services/subscriptionService.ts
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { TicketMinter, getTicketMinter } from "./ticketMinter";
import { WalrusUserManager, getWalrusUserManager } from "./walrusUserManager";
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
  }

  // In-memory fallback if Redis/Walrus fails
  private memoryCache = new Map<string, { count: number, date: string }>();

  private getTodayDate(): string {
    return new Date().toISOString().split("T")[0];
  }

  private needsDailyReset(lastDate: string | undefined): boolean {
    if (!lastDate) return true;
    return lastDate !== this.getTodayDate();
  }

  // Cache tier for 5 minutes to avoid spamming RPC
  private tierCache = new Map<string, { data: any, timestamp: number }>();

  async getCurrentTier(walletAddress: string): Promise<{
    tier: number;
    expires_at: number;
    isActivePremium: boolean;
  }> {
    // Check cache
    const cached = this.tierCache.get(walletAddress);
    const now = Date.now();
    if (cached && (now - cached.timestamp < 5 * 60 * 1000)) {
      return cached.data;
    }

    try {
      const onChain = await this.getOnChainSubscription(walletAddress);
      let result;

      if (onChain) {
        const isActivePremium = onChain.tier === 1 && onChain.expires_at > now;
        result = {
          tier: isActivePremium ? 1 : 0,
          expires_at: onChain.expires_at,
          isActivePremium,
        };
      } else {
        console.warn(
          `[SUBSCRIPTION] On-chain check failed, trying Walrus fallback...`,
        );
        const walrusData = await this.getWalrusSubscription(walletAddress);

        if (walrusData) {
          // ✅ FIX: Ensure boolean type
          const isActivePremium = Boolean(
            walrusData.tier === 1 &&
            walrusData.expires_at &&
            new Date(walrusData.expires_at).getTime() > now,
          );

          result = {
            tier: isActivePremium ? 1 : 0,
            expires_at: walrusData.expires_at
              ? new Date(walrusData.expires_at).getTime()
              : 0,
            isActivePremium,
          };
        } else {
          result = { tier: 0, expires_at: 0, isActivePremium: false };
        }
      }

      this.tierCache.set(walletAddress, { data: result, timestamp: now });
      return result;

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
    let retries = 3;
    while (retries > 0) {
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
        console.warn(`[SUBSCRIPTION] On-chain check failed (retries left: ${retries - 1}):`, error);
        retries--;
        if (retries === 0) {
          console.error("Error getting on-chain subscription after retries:", error);
          return null;
        }
        await new Promise((res) => setTimeout(res, 1000 * (4 - retries))); // Backoff
      }
    }
    return null;
  }

  async getWalrusSubscription(walletAddress: string): Promise<{
    tier: number;
    expires_at?: string;
    daily_prompts_used: number;
    last_prompt_date?: string;
  } | null> {
    try {
      const ticketMinter = getTicketMinter();
      const userRegistryBlobId = await ticketMinter.getCurrentBlobId();

      if (!userRegistryBlobId) return null;

      const userManager = getWalrusUserManager();
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
      const ticketMinter = getTicketMinter();
      const userRegistryBlobId = await ticketMinter.getCurrentBlobId();

      if (!userRegistryBlobId) return false;

      const userManager = getWalrusUserManager();
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




      // Layer 1: Redis fast check
      if (redisClient && redisClient.isOpen) {
        const redisKey = `prompts:${walletAddress}:${today}`;

        try {
          const count = await redisClient.get(redisKey);


          if (count) {
            const used = parseInt(count);

            if (used < limit) {

              return true;
            } else {

              return false;
            }
          } else {
            // No Redis data - new user or daily reset happened

            return true;
          }
        } catch (redisError) {
          console.warn(
            "[SUBSCRIPTION] Redis check failed, falling back to Walrus",
            redisError,
          );
        }
        // Layer 1.5: In-Memory fallback (if Redis is down)
        const mem = this.memoryCache.get(walletAddress);
        if (mem && mem.date === today) {
          if (mem.count >= limit) {
            return false;
          }
          // If memory says OK, we still check Walrus/Redis to be sure? 
          // No, if memory has it, trust it for blocking (failsafe).
          // Actually, let's treat memory as authoritative for blocking if it exceeds limit.
        } else if (mem && mem.date !== today) {
          // Reset memory for new day
          this.memoryCache.delete(walletAddress);
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

        return true;
      }

      const canUse = walrusData.daily_prompts_used < limit;



      return canUse;
    } catch (error) {
      console.error("Error checking prompt limit:", error);
      return true;
    }
  }

  async trackPromptUsage(walletAddress: string): Promise<boolean> {
    try {
      const today = this.getTodayDate();

      const tierStatus = await this.getCurrentTier(walletAddress);
      const walrusData = await this.getWalrusSubscription(walletAddress);

      const needsReset = this.needsDailyReset(walrusData?.last_prompt_date);
      let currentUsed = needsReset ? 0 : walrusData?.daily_prompts_used || 0;

      // Layer 1.5: Check In-Memory Cache for more recent usage
      const mem = this.memoryCache.get(walletAddress);
      if (mem && mem.date === today && mem.count > currentUsed) {
        currentUsed = mem.count;
      } else if (mem && mem.date !== today) {
        this.memoryCache.delete(walletAddress);
      }

      const newUsed = currentUsed + 1;

      // Update In-Memory Cache IMMEDIATELY
      this.memoryCache.set(walletAddress, { count: newUsed, date: today });

      // Try persistent storage updates (fail safe)
      try {
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
        }
      } catch (externalError) {
        console.warn("[SUBSCRIPTION] Failed to update persistent storage, relying on memory:", externalError);
      }

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
      let used = needsReset ? 0 : walrusData.daily_prompts_used;
      const today = this.getTodayDate();

      // Layer 1: Check Redis fast check (Primary Source of Trurth for blocking)
      if (redisClient && redisClient.isOpen) {
        const redisKey = `prompts:${walletAddress}:${today}`;
        try {
          const count = await redisClient.get(redisKey);
          if (count) {
            const redisUsed = parseInt(count);
            if (redisUsed > used) {
              used = redisUsed;
            }
          }
        } catch (e) {
          console.warn("[SUBSCRIPTION] Redis check failed in getPromptsRemaining:", e);
        }
      }

      // Layer 1.5: Check In-Memory Cache for more recent usage
      const mem = this.memoryCache.get(walletAddress);

      if (mem && mem.date === today && mem.count > used) {
        used = mem.count;
      }

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
