import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { getSupabaseClient } from "../config/supabase";
import { getUserManager } from "./userManager";

const NETWORK = (process.env.SUI_NETWORK || "testnet") as "testnet" | "mainnet";
const PACKAGE_ID = process.env.SUI_PACKAGE_ID || "";
const supabase = getSupabaseClient();

interface LeaderboardStore {
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

  private constructor() {}

  public static getInstance(): LeaderboardService {
    if (!LeaderboardService.instance) {
      LeaderboardService.instance = new LeaderboardService();
    }
    return LeaderboardService.instance;
  }

  private normalizeAddr(addr: string): string {
    return (
      "0x" + (addr.startsWith("0x") ? addr.slice(2) : addr).padStart(64, "0")
    ).toLowerCase();
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
      const total = await this.getTotalParticipants();

      return {
        rank: points > 0 ? (rankCount || 0) + 1 : null,
        points: points,
        total_participants: total,
      };
    } catch (err) {
      console.error("[LEADERBOARD] getUserRank failed:", err);
      return { rank: null, points: 0, total_participants: 0 };
    }
  }

  public async getTotalParticipants(): Promise<number> {
    try {
      const { count: total, error: totalError } = await supabase
        .from('user_profiles')
        .select('*', { count: 'exact', head: true })
        .gt('points', 0);

      if (totalError) throw totalError;
      return total || 0;
    } catch (err) {
      console.error("[LEADERBOARD] Failed to get total participants:", err);
      return 0;
    }
  }
}

export const getLeaderboardService = () => LeaderboardService.getInstance();
