import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { getWalrusUserManager } from "./walrusUserManager";
import { getTicketMinter } from "./ticketMinter";

const NETWORK = (process.env.SUI_NETWORK || "testnet") as "testnet" | "mainnet";
const PACKAGE_ID = process.env.SUI_PACKAGE_ID || "";
const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../data");
const STORE_FILE = path.join(DATA_DIR, "leaderboard_store.json");

interface UserState {
  balance: number;
  ts: number;
}

interface LeaderboardStore {
  users: Record<string, UserState>;
  cursors: {
    points: string | null;
    tasks: string | null;
  };
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
      users: {},
      cursors: { points: null, tasks: null },
      lastUpdated: 0,
    };
    this.loadState();
  }

  public static getInstance(): LeaderboardService {
    if (!LeaderboardService.instance) {
      LeaderboardService.instance = new LeaderboardService();
    }
    return LeaderboardService.instance;
  }

  private loadState() {
    try {
      if (fs.existsSync(STORE_FILE)) {
        const data = fs.readFileSync(STORE_FILE, "utf-8");
        this.store = JSON.parse(data);
        console.log(`[LEADERBOARD] Loaded state: ${Object.keys(this.store.users).length} users`);
      }
    } catch (err) {
      console.error("[LEADERBOARD] Failed to load state:", err);
    }
  }

  private saveState() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(STORE_FILE, JSON.stringify(this.store, null, 2));
    } catch (err) {
      console.error("[LEADERBOARD] Failed to save state:", err);
    }
  }

  private normalizeAddr(addr: string): string {
    return "0x" + (addr.startsWith("0x") ? addr.slice(2) : addr).padStart(64, "0");
  }

  private async fetchNewEvents(
    eventType: string,
    cursorKey: "points" | "tasks",
    balanceField: "new_balance",
    walletField: "wallet_address"
  ) {
    let hasNext = true;
    let cursor = this.store.cursors[cursorKey];
    let fetchedCount = 0;

    // Safety limit to prevent infinite loops if something weird happens
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
        const ts = parseInt(data.timestamp || "0", 10);

        const currentUser = this.store.users[wallet];

        // Update if we have a newer (or same-time higher) balance 
        // Same-time higher is a heuristic if multiple events happen in same ms
        if (
          !currentUser ||
          ts > currentUser.ts ||
          (ts === currentUser.ts && balance > currentUser.balance)
        ) {
          this.store.users[wallet] = { balance, ts };
        }
      }

      fetchedCount += page.data.length;
      hasNext = page.hasNextPage;
      cursor = page.nextCursor as any;
      pages++;
    }

    if (cursor) {
      this.store.cursors[cursorKey] = cursor as any;
    }

    return fetchedCount;
  }

  public async updateLeaderboard() {
    if (this.isUpdating) {
      // console.log("[LEADERBOARD] Update already in progress");
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

      this.store.lastUpdated = Date.now();

      // Save only if we fetched something or it's been a while? 
      // Save always to update lastUpdated
      this.saveState();

      if (pCount > 0 || tCount > 0) {
        console.log(`[LEADERBOARD] Update complete. New events: Points=${pCount}, TaskPoints=${tCount}`);
      }
    } catch (err) {
      console.error("[LEADERBOARD] Update failed:", err);
    } finally {
      this.isUpdating = false;
    }
  }

  public async getLeaderboard(limit = 100): Promise<LeaderboardEntry[]> {
    // Trigger background update if stale (> 30s)
    const now = Date.now();
    if (now - this.store.lastUpdated > 30 * 1000) {
      this.updateLeaderboard();
    }

    const sortedWallets = Object.entries(this.store.users)
      .filter(([, user]) => user.balance > 0)
      .sort(([, a], [, b]) => b.balance - a.balance)
      .slice(0, limit);

    // Enrich with usernames
    const enriched: LeaderboardEntry[] = [];
    const userManager = getWalrusUserManager();
    const minter = getTicketMinter();

    const blobId = await minter.getCurrentBlobId().catch(() => null);

    for (let i = 0; i < sortedWallets.length; i++) {
      const [wallet, user] = sortedWallets[i];
      let username = undefined;

      if (blobId) {
        try {
          // This is cached in memory by WalrusUserManager effectively if we use registry
          // But getUserProfile does a fetch. 
          // We should rely on UserRegistry if possible for speed.
          // But WalrusUserManager doesn't expose registry directly easily.
          // getUserProfile is fine for top 100, might be a bit slow on first cold load.
          const profile = await userManager.getUserProfile(blobId, wallet);
          username = profile?.username;
        } catch (e) {
          // ignore
        }
      }

      enriched.push({
        rank: i + 1,
        user_id: wallet,
        wallet_address: wallet,
        username,
        points: user.balance,
        referral_points: 0
      });
    }

    return enriched;
  }

  public getUserBalance(walletAddress: string): number {
    const norm = this.normalizeAddr(walletAddress);
    // Trigger update if very stale?
    // For user balance, we might want to be fresher.
    // But let's stick to the shared updated loop.
    return this.store.users[norm]?.balance || 0;
  }
}

export const getLeaderboardService = () => LeaderboardService.getInstance();
