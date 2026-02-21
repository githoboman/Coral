
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { TicketMinter, getTicketMinter } from "./ticketMinter";
import { UserManager, getUserManager } from "./userManager";
import { redisClient } from "../middleware/rateLimiter";
import { getSupabaseClient } from "../config/supabase";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export class SubscriptionService {
  private client: SuiClient;
  private packageId: string;
  private subscriptionRegistryId: string;
  private isIndexing = false;

  constructor() {
    const network = process.env.SUI_NETWORK || "testnet";
    this.client = new SuiClient({
      url: getFullnodeUrl(network as "testnet" | "mainnet"),
    });

    this.packageId = process.env.SUI_PACKAGE_ID || "";
    this.subscriptionRegistryId =
      process.env.SUI_SUBSCRIPTION_REGISTRY_ID || "";
  }

  // In-memory fallback if Redis fails
  private memoryCache = new Map<string, { count: number, date: string }>();

  async startRevenueIndexer(intervalMs = 60000) {
    console.log("[REVENUE INDEXER] Starting...");
    this.indexRevenueEvents(); // Run immediately
    setInterval(() => this.indexRevenueEvents(), intervalMs);
  }

  async indexRevenueEvents() {
    if (this.isIndexing) return;
    this.isIndexing = true;

    try {
      const supabase = getSupabaseClient();

      // 1. Get last indexed timestamp
      const { data: lastEvent } = await supabase
        .from('revenue_events')
        .select('timestamp')
        .order('timestamp', { ascending: false })
        .limit(1)
        .single();

      let lastTime = lastEvent?.timestamp
        ? new Date(lastEvent.timestamp).getTime()
        : 0;

      // Helper to fetch and insert events with pagination
      const fetchAndInsert = async (eventType: string, typeName: string, defaultAmount: number = 0) => {
        let hasNext = true;
        let cursor = null;
        let totalInserted = 0;

        while (hasNext) {
          const response: any = await this.client.queryEvents({
            query: { MoveEventType: eventType },
            limit: 50,
            order: "descending",
            cursor: cursor,
          });

          const newEvents: any[] = [];

          for (const ev of response.data) {
            const data = ev.parsedJson as any;

            // Check if exists (deduplication)
            const { count } = await supabase.from('revenue_events').select('id', { count: 'exact', head: true }).eq('tx_digest', ev.id.txDigest);
            if (count && count > 0) continue;

            // Determine amount based on event type
            let amount = defaultAmount;
            if (amount === 0) {
              amount = Number(data.amount || data.amount_paid || data.fee || data.points || 0);
            }

            newEvents.push({
              tx_digest: ev.id.txDigest,
              sender: data.user || data.sender || data.wallet_address || data.claimer,
              amount: amount,
              event_type: typeName,
              timestamp: new Date(Number(ev.timestampMs)).toISOString()
            });
          }

          if (newEvents.length > 0) {
            const { error } = await supabase.from('revenue_events').insert(newEvents);
            if (!error) totalInserted += newEvents.length;
            else console.error(`[REVENUE INDEXER] Insert error for ${typeName}:`, error);
          }

          if (hasNext && response.hasNextPage) {
            cursor = response.nextCursor;
          } else {
            hasNext = false;
          }
        }
        if (totalInserted > 0) console.log(`[REVENUE INDEXER] Indexed ${totalInserted} ${typeName} events.`);
      };

      // 2. Fetch Subscription Events
      await fetchAndInsert(
        `${this.packageId}::subscriptions::PremiumSubscribed`,
        'subscription'
      );

      // 3. Fetch CheckIn Fee Events
      await fetchAndInsert(
        `${this.packageId}::points::CheckInCompleted`,
        'checkin_fee',
        2000000 // 2M MIST est.
      );

      // 4. Fetch Task Claim Events (PointsClaimed)
      await fetchAndInsert(
        `${this.packageId}::points::PointsClaimed`,
        'task_claim'
      );

    } catch (e) {
      console.error("[REVENUE INDEXER] Error:", e);
    } finally {
      this.isIndexing = false;
    }
  }

  private getTodayDate(): string {
    return new Date().toISOString().split("T")[0];
  }

  private needsDailyReset(lastDate: string | undefined): boolean {
    if (!lastDate) return true;
    return lastDate !== this.getTodayDate();
  }

  // Cache tier for 5 minutes to avoid spamming RPC
  private tierCache = new Map<string, { data: any, timestamp: number }>();

  async getCurrentTier(walletAddress: string, forceRefresh = false): Promise<{
    tier: number;
    expires_at: number;
    isActivePremium: boolean;
  }> {
    const cached = this.tierCache.get(walletAddress);
    const now = Date.now();
    if (!forceRefresh && cached && (now - cached.timestamp < 5 * 60 * 1000)) {
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
        console.warn(`[SUBSCRIPTION] On-chain check failed, trying Supabase fallback...`);
        const supabaseData = await this.getSupabaseSubscription(walletAddress);

        if (supabaseData) {
          const isActivePremium = Boolean(
            supabaseData.tier === 1 &&
            supabaseData.expires_at &&
            new Date(supabaseData.expires_at).getTime() > now,
          );

          result = {
            tier: isActivePremium ? 1 : 0,
            expires_at: supabaseData.expires_at
              ? new Date(supabaseData.expires_at).getTime()
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
        await new Promise((res) => setTimeout(res, 1000 * (4 - retries)));
      }
    }
    return null;
  }

  async getSupabaseSubscription(walletAddress: string): Promise<{
    tier: number;
    expires_at?: string;
    daily_prompts_used: number;
    last_prompt_date?: string;
    daily_research_prompts_used?: number;
    last_research_prompt_date?: string;
  } | null> {
    try {
      const userManager = getUserManager();
      const profile = await userManager.getUserProfile(walletAddress);

      if (!profile) return null;

      return {
        tier: profile.subscription_tier || 0,
        expires_at: profile.subscription_expires_at,
        daily_prompts_used: profile.daily_prompts_used || 0,
        last_prompt_date: profile.last_prompt_date,
        daily_research_prompts_used: profile.daily_research_prompts_used,
        last_research_prompt_date: profile.last_research_prompt_date,
      };
    } catch (error) {
      console.error("Error getting Supabase subscription:", error);
      return null;
    }
  }

  async updateSupabaseSubscription(
    walletAddress: string,
    updates: {
      tier?: number;
      expires_at?: string;
      daily_prompts_used?: number;
      last_prompt_date?: string;
      daily_research_prompts_used?: number;
      last_research_prompt_date?: string;
    },
  ): Promise<boolean> {
    try {
      const userManager = getUserManager();
      const profile = await userManager.getUserProfile(walletAddress);

      if (!profile) return false;

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
          daily_research_prompts_used:
            updates.daily_research_prompts_used !== undefined
              ? updates.daily_research_prompts_used
              : profile.daily_research_prompts_used,
          last_research_prompt_date:
            updates.last_research_prompt_date || profile.last_research_prompt_date,
        },
      );

      const result = await userManager.addOrUpdateUser(updatedProfile);
      return !!result;
    } catch (error) {
      console.error("Error updating Supabase subscription:", error);
      return false;
    }
  }

  async canUsePrompt(walletAddress: string, type: 'task' | 'research' = 'task'): Promise<boolean> {
    try {
      const today = this.getTodayDate();
      const tierStatus = await this.getCurrentTier(walletAddress);

      let limit = 0;
      if (type === 'task') {
        limit = tierStatus.isActivePremium ? 5 : 2;
      } else {
        // Research Agent: 6 for premium, 3 for free
        limit = tierStatus.isActivePremium ? 6 : 3;
      }

      if (redisClient && redisClient.isOpen) {
        const redisKey = `${type}:prompts:${walletAddress}:${today}`;
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
            return true;
          }
        } catch (redisError) {
          console.warn(`[SUBSCRIPTION] Redis check failed for ${type}, falling back to Supabase`, redisError);
        }
      }

      // Memory cache logic updated for types
      const memKey = `${type}:${walletAddress}`;
      const mem = this.memoryCache.get(memKey);
      if (mem && mem.date === today) {
        if (mem.count >= limit) {
          return false;
        }
      } else if (mem && mem.date !== today) {
        this.memoryCache.delete(memKey);
      }

      const supabaseData = await this.getSupabaseSubscription(walletAddress);
      if (!supabaseData) return true;

      const lastDate = type === 'task' ? supabaseData.last_prompt_date : supabaseData.last_research_prompt_date;
      const used = type === 'task' ? supabaseData.daily_prompts_used : (supabaseData.daily_research_prompts_used || 0);

      if (this.needsDailyReset(lastDate)) {
        return true;
      }

      return used < limit;
    } catch (error) {
      console.error(`Error checking ${type} prompt limit:`, error);
      return true;
    }
  }

  async trackPromptUsage(walletAddress: string, type: 'task' | 'research' = 'task'): Promise<boolean> {
    try {
      const today = this.getTodayDate();
      const tierStatus = await this.getCurrentTier(walletAddress);
      const supabaseData = await this.getSupabaseSubscription(walletAddress);

      const lastDate = type === 'task' ? supabaseData?.last_prompt_date : supabaseData?.last_research_prompt_date;
      const needsReset = this.needsDailyReset(lastDate);

      let currentUsed = 0;
      if (!needsReset) {
        currentUsed = type === 'task' ? supabaseData?.daily_prompts_used || 0 : supabaseData?.daily_research_prompts_used || 0;
      }

      const memKey = `${type}:${walletAddress}`;
      const mem = this.memoryCache.get(memKey);
      if (mem && mem.date === today && mem.count > currentUsed) {
        currentUsed = mem.count;
      } else if (mem && mem.date !== today) {
        this.memoryCache.delete(memKey);
      }

      const newUsed = currentUsed + 1;
      this.memoryCache.set(memKey, { count: newUsed, date: today });

      try {
        await getUserManager().incrementPromptUsage(walletAddress, type, today);

        if (redisClient && redisClient.isOpen) {
          const redisKey = `${type}:prompts:${walletAddress}:${today}`;
          await redisClient.set(redisKey, newUsed.toString(), {
            EX: 86400,
          });
        }
      } catch (externalError) {
        console.warn(`[SUBSCRIPTION] Failed to update persistent storage for ${type}, relying on memory:`, externalError);
      }

      return true;
    } catch (error) {
      console.error(`Error tracking ${type} prompt usage:`, error);
      return false;
    }
  }

  async getPromptsRemaining(walletAddress: string, type: 'task' | 'research' = 'task'): Promise<{
    used: number;
    limit: number;
    remaining: number;
    tier: number;
  }> {
    try {
      const tierStatus = await this.getCurrentTier(walletAddress);

      let limit = 0;
      if (type === 'task') {
        limit = tierStatus.isActivePremium ? 5 : 2;
      } else {
        limit = tierStatus.isActivePremium ? 6 : 3;
      }

      const supabaseData = await this.getSupabaseSubscription(walletAddress);

      if (!supabaseData) {
        return { used: 0, limit, remaining: limit, tier: tierStatus.tier };
      }

      const lastDate = type === 'task' ? supabaseData.last_prompt_date : supabaseData.last_research_prompt_date;
      const supabaseUsed = type === 'task' ? supabaseData.daily_prompts_used : (supabaseData.daily_research_prompts_used || 0);

      const needsReset = this.needsDailyReset(lastDate);
      let used = needsReset ? 0 : supabaseUsed;
      const today = this.getTodayDate();

      if (redisClient && redisClient.isOpen) {
        const redisKey = `${type}:prompts:${walletAddress}:${today}`;
        try {
          const count = await redisClient.get(redisKey);
          if (count) {
            const redisUsed = parseInt(count);
            if (redisUsed > used) {
              used = redisUsed;
            }
          }
        } catch (e) {
          console.warn(`[SUBSCRIPTION] Redis check failed in getPromptsRemaining for ${type}:`, e);
        }
      }

      const memKey = `${type}:${walletAddress}`;
      const mem = this.memoryCache.get(memKey);
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
      console.error(`Error getting ${type} prompts remaining:`, error);
      const defaultLimit = type === 'task' ? 2 : 3;
      return { used: 0, limit: defaultLimit, remaining: defaultLimit, tier: 0 };
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
    subscriptionService.startRevenueIndexer();
  }
  return subscriptionService;
}
