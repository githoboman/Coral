import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { getSupabaseClient } from "../config/supabase";
import { getUserManager } from "./userManager";

const NETWORK = (process.env.SUI_NETWORK || "testnet") as "testnet" | "mainnet";
const PACKAGE_ID = process.env.SUI_PACKAGE_ID || "";
const supabase = getSupabaseClient();

interface LeaderboardStore {
  cursors: Record<string, string | null>;
  lastUpdated: number;
}

export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  wallet_address: string;
  username?: string;
  points: number;
  referral_points: number;
}

class LeaderboardService {
  private static instance: LeaderboardService;
  private suiClient: SuiClient;
  private store: LeaderboardStore;
  private isUpdating = false;

  private constructor() {
    this.suiClient = new SuiClient({ url: getFullnodeUrl(NETWORK) });
    this.store = {
      cursors: { points: null, tasks: null, checkins: null },
      lastUpdated: 0,
    };
    // Cursors will be loaded on-demand in fetchNewEvents to ensure they are fresh
  }

  public static getInstance(): LeaderboardService {
    if (!LeaderboardService.instance) {
      LeaderboardService.instance = new LeaderboardService();
    }
    return LeaderboardService.instance;
  }

  private async getCursor(key: string): Promise<string | null> {
    if (this.store.cursors[key]) return this.store.cursors[key];
    
    try {
      const { data, error } = await supabase
        .from('indexer_state')
        .select('last_cursor')
        .eq('id', key)
        .maybeSingle();
      
      if (error) throw error;
      return data?.last_cursor || null;
    } catch (err) {
      console.error(`[LEADERBOARD] Failed to get cursor for ${key}:`, err);
      return null;
    }
  }

  private async saveCursor(key: string, cursor: string) {
    try {
      const { error } = await supabase
        .from('indexer_state')
        .upsert({ id: key, last_cursor: cursor });
      
      if (error) throw error;
      this.store.cursors[key] = cursor;
    } catch (err) {
      console.error(`[LEADERBOARD] Failed to save cursor for ${key}:`, err);
    }
  }

  private normalizeAddr(addr: string): string {
    return (
      "0x" + (addr.startsWith("0x") ? addr.slice(2) : addr).padStart(64, "0")
    ).toLowerCase();
  }

  private async fetchNewEvents(
    eventType: string,
    cursorKey: string,
    balanceField: string,
    walletField: string
  ) {
    let hasNext = true;
    let cursor = await this.getCursor(cursorKey);
    let fetchedCount = 0;

    // Safety limit to prevent infinite loops
    const MAX_PAGES = 100;
    let pages = 0;

    while (hasNext && pages < MAX_PAGES) {
      let page = null;
      let retries = 3;
      while (retries > 0) {
        try {
          page = await this.suiClient.queryEvents({
            query: { MoveEventType: eventType },
            cursor: cursor ? (cursor as any) : undefined,
            limit: 50,
            order: "ascending",
          });
          break; // Success
        } catch (err) {
          console.warn(`[LEADERBOARD] Query failed (retries left: ${retries - 1}):`, err);
          retries--;
          if (retries === 0) throw err;
          await new Promise((res) => setTimeout(res, 1000 * (4 - retries))); // Backoff
        }
      }

      if (!page) break;

      for (const ev of page.data) {
        const data = ev.parsedJson as any;
        if (!data) continue;

        const wallet = this.normalizeAddr(data[walletField] || "");
        const balance = parseInt(data[balanceField] || "0", 10);
        // Note: timestamp in Sui events is usually ms or s. Leaderboard uses it for ordering.

        // SAFETY CHECK: Only update if the new (on-chain) balance is HIGHER than what we currently have.
        // This prevents clones/manual boosts from being clobbered by older on-chain indexing.
        const { data: currentProfile } = await supabase
          .from('user_profiles')
          .select('points')
          .eq('wallet_address', wallet)
          .maybeSingle();
        
        const currentPoints = currentProfile?.points || 0;

        if (balance > currentPoints) {
           await supabase
            .from('user_profiles')
            .upsert({ 
              wallet_address: wallet, 
              user_id: wallet, 
              points: balance,
              xp: balance 
            }, { onConflict: 'wallet_address' });
            // console.log(`[LEADERBOARD] Synced on-chain balance for ${wallet}: ${balance} (was ${currentPoints})`);
        }
      }

      fetchedCount += page.data.length;
      hasNext = page.hasNextPage;
      cursor = page.nextCursor as any;
      
      if (cursor) {
        await this.saveCursor(cursorKey, (cursor as any).eventSeq); // Store just the important part or serialized
        // Actually, Sui cursor is an object. Let's store it as JSON string or the whole thing if text.
        await this.saveCursor(cursorKey, JSON.stringify(cursor));
      }
      pages++;
    }

    return fetchedCount;
  }

  public async updateLeaderboard() {
    if (this.isUpdating) {
      return;
    }
    if (!PACKAGE_ID) return;

    this.isUpdating = true;
    try {
      const pCount = await this.fetchNewEvents(
        `${PACKAGE_ID}::points::PointsClaimed`,
        "points",
        "new_balance",
        "wallet_address"
      );

      const tCount = await this.fetchNewEvents(
        `${PACKAGE_ID}::task_points::TaskPointsClaimed`,
        "tasks",
        "new_balance",
        "wallet_address"
      );

      const cCount = await this.fetchNewEvents(
        `${PACKAGE_ID}::points::CheckInCompleted`,
        "checkins",
        "new_balance",
        "wallet_address"
      );

      this.store.lastUpdated = Date.now();

      if (pCount > 0 || tCount > 0 || cCount > 0) {
        console.log(`[LEADERBOARD] Update complete. New events indexed: Points=${pCount}, TaskPoints=${tCount}, CheckIns=${cCount}`);
      }
    } catch (err) {
      console.error("[LEADERBOARD] Update failed:", err);
    } finally {
      this.isUpdating = false;
    }
  }

  /** Force an immediate leaderboard update (e.g. after a check-in) */
  public async forceUpdate(): Promise<void> {
    this.isUpdating = false; // Reset guard
    await this.updateLeaderboard();
  }

  /**
   * Directly credit points to a user in Supabase.
   * This provides instant updates without waiting for on-chain event indexing.
   */
  public async creditPoints(walletAddress: string, pointsToAdd: number): Promise<void> {
    const norm = this.normalizeAddr(walletAddress);

    // Persist to Supabase immediately for live updates
    try {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('points')
        .eq('wallet_address', norm)
        .single();
      
      const currentPoints = profile?.points || 0;
      const finalPoints = currentPoints + pointsToAdd;

      const { error } = await supabase
        .from('user_profiles')
        .upsert({ 
          wallet_address: norm, 
          user_id: norm, 
          points: finalPoints,
          xp: finalPoints // Sync xp with points
        }, { onConflict: 'wallet_address' });

      if (error) throw error;
      console.log(`[LEADERBOARD] Credited ${pointsToAdd} points to ${norm.substring(0, 10)}... (DB balance: ${finalPoints})`);
    } catch (err) {
      console.error("[LEADERBOARD] Failed to sync credit to Supabase:", err);
    }

    // Schedule a delayed sync with on-chain events (10s to allow tx propagation)
    setTimeout(() => {
      this.forceUpdate().catch(err =>
        console.warn("[LEADERBOARD] Delayed sync failed:", err)
      );
    }, 10_000);
  }

  public async getLeaderboard(limit = 100): Promise<LeaderboardEntry[]> {
    try {
      // Fetch top users directly from Supabase for live data
      const { data: profiles, error } = await supabase
        .from('user_profiles')
        .select('wallet_address, username, points')
        .gt('points', 0)
        .order('points', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return (profiles || []).map((p, idx) => ({
        rank: idx + 1,
        user_id: p.wallet_address,
        wallet_address: p.wallet_address,
        username: p.username,
        points: p.points || 0,
        referral_points: 0
      }));
    } catch (err) {
      console.error("[LEADERBOARD] getLeaderboard failed:", err);
      return [];
    }
  }

  public async getUserBalance(walletAddress: string): Promise<number> {
    const norm = this.normalizeAddr(walletAddress);
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('points')
        .eq('wallet_address', norm)
        .maybeSingle();
      
      if (error) throw error;
      return data?.points || 0;
    } catch (err) {
      console.error(`[LEADERBOARD] Failed to get balance for ${norm}:`, err);
      return 0;
    }
  }

  /**
   * Get a specific user's rank across ALL users (not just top 100).
   * Returns rank (1-indexed), points, and total participants.
   */
  public async getUserRank(walletAddress: string): Promise<{
    rank: number | null;
    points: number;
    total_participants: number;
  }> {
    const norm = this.normalizeAddr(walletAddress);

    try {
      // 1. Get user's points
      const { data: user, error: userError } = await supabase
        .from('user_profiles')
        .select('points')
        .eq('wallet_address', norm)
        .single();
      
      if (userError && userError.code !== 'PGRST116') throw userError;
      const points = user?.points || 0;

      // 2. Count users with more points for rank
      const { count: rankCount, error: rankError } = await supabase
        .from('user_profiles')
        .select('*', { count: 'exact', head: true })
        .gt('points', points);
      
      if (rankError) throw rankError;

      // 3. Get total participants (users with points > 0)
      const { count: total, error: totalError } = await supabase
        .from('user_profiles')
        .select('*', { count: 'exact', head: true })
        .gt('points', 0);

      if (totalError) throw totalError;

      return {
        rank: points > 0 ? (rankCount || 0) + 1 : null,
        points: points,
        total_participants: total || 0,
      };
    } catch (err) {
      console.error("[LEADERBOARD] getUserRank failed:", err);
      return { rank: null, points: 0, total_participants: 0 };
    }
  }
}

export const getLeaderboardService = () => LeaderboardService.getInstance();
