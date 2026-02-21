import { getTicketMinter } from "./ticketMinter";
import { getWalrusUserManager } from "./walrusUserManager";
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
    console.log("🔥 [CACHE WARMER] Starting cache warmup...");
    const start = Date.now();

    try {
      // 1. Warm up TicketMinter (fetches current Blob Registry ID from Sui)
      const minter = getTicketMinter();
      console.log("🔥 [CACHE WARMER] Fetching current Blob ID from Sui...");
      const blobId = await minter.getCurrentBlobId();

      if (blobId) {
        console.log(`🔥 [CACHE WARMER] Blob ID cached: ${blobId}`);
      }

      // 2. Warm up Leaderboard (fetches new events from Sui)
      console.log("🔥 [CACHE WARMER] Updating Leaderboard...");
      await getLeaderboardService().updateLeaderboard();
      console.log("🔥 [CACHE WARMER] Leaderboard updated!");

      const duration = Date.now() - start;
      console.log(`✅ [CACHE WARMER] Warmup complete in ${duration}ms! 🚀`);
    } catch (error) {
      console.error("❌ [CACHE WARMER] Warmup failed:", error);
    }
  }
}

export const getCacheWarmer = () => CacheWarmer.getInstance();
