import { getLeaderboardService } from "./leaderboardService";

export class CacheWarmer {
  private static instance: CacheWarmer;

  private constructor() { }

  public static getInstance(): CacheWarmer {
    if (!CacheWarmer.instance) {
      CacheWarmer.instance = new CacheWarmer();
    }
    return CacheWarmer.instance;
  }

  public async warmup() {
    console.log("[CACHE WARMER] Starting cache warmup...");
    const start = Date.now();

    try {
      // Warm up Leaderboard (fetches live top users from Supabase to warm DB connection)
      console.log("[CACHE WARMER] Warming DB connection for Leaderboard...");
      await getLeaderboardService().getLeaderboard(10);
      console.log("[CACHE WARMER] Leaderboard ready!");

      const duration = Date.now() - start;
      console.log(`[CACHE WARMER] Warmup complete in ${duration}ms!`);
    } catch (error) {
      console.error("[CACHE WARMER] Warmup failed:", error);
    }
  }
}

export const getCacheWarmer = () => CacheWarmer.getInstance();
