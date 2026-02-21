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
      // Warm up Leaderboard (fetches new events from Sui)
      console.log("[CACHE WARMER] Updating Leaderboard...");
      await getLeaderboardService().updateLeaderboard();
      console.log("[CACHE WARMER] Leaderboard updated!");

      const duration = Date.now() - start;
      console.log(`[CACHE WARMER] Warmup complete in ${duration}ms!`);
    } catch (error) {
      console.error("[CACHE WARMER] Warmup failed:", error);
    }
  }
}

export const getCacheWarmer = () => CacheWarmer.getInstance();
