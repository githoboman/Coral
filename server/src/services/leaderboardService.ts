import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { getUserManager } from "./userManager";

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
    checkins: string | null;
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
      cursors: { points: null, tasks: null, checkins: null },
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
    cursorKey: "points" | "tasks" | "checkins",
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

      const cCount = await this.fetchNewEvents(
        `${PACKAGE_ID}::points::CheckInCompleted`,
        "checkins",
        "new_balance",
        "wallet_address"
      );

      this.store.lastUpdated = Date.now();

      // Save always to update lastUpdated
      this.saveState();

      if (pCount > 0 || tCount > 0 || cCount > 0) {
        console.log(`[LEADERBOARD] Update complete. New events: Points=${pCount}, TaskPoints=${tCount}, CheckIns=${cCount}`);
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
   * Directly credit points to a user in the leaderboard store.
   * This provides instant updates without waiting for on-chain event indexing.
   * A delayed forceUpdate is scheduled to eventually sync with on-chain truth.
   */
  public creditPoints(walletAddress: string, pointsToAdd: number): void {
    const existing = this.store.users[walletAddress];
    if (existing) {
      existing.balance += pointsToAdd;
      existing.ts = Date.now();
    } else {
      this.store.users[walletAddress] = {
        balance: pointsToAdd,
        ts: Date.now(),
      };
    }
    this.store.lastUpdated = Date.now();
    this.saveState();
    console.log(`[LEADERBOARD] Credited ${pointsToAdd} points to ${walletAddress.substring(0, 10)}... (new balance: ${this.store.users[walletAddress].balance})`);

    // Schedule a delayed sync with on-chain events (10s to allow tx propagation)
    setTimeout(() => {
      this.forceUpdate().catch(err =>
        console.warn("[LEADERBOARD] Delayed sync failed:", err)
      );
    }, 10_000);
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
    const userManager = getUserManager();

    for (let i = 0; i < sortedWallets.length; i++) {
      const [wallet, user] = sortedWallets[i];
      let username = undefined;

      try {
        const profile = await userManager.getUserProfile(wallet);
        username = profile?.username;
      } catch (e) {
        // ignore
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
    return this.store.users[norm]?.balance || 0;
  }

  /**
   * Get a specific user's rank across ALL users (not just top 100).
   * Returns rank (1-indexed), points, and total participants.
   */
  public getUserRank(walletAddress: string): {
    rank: number | null;
    points: number;
    total_participants: number;
  } {
    const norm = this.normalizeAddr(walletAddress);
    const userState = this.store.users[norm];

    const allSorted = Object.entries(this.store.users)
      .filter(([, u]) => u.balance > 0)
      .sort(([, a], [, b]) => b.balance - a.balance);

    const total = allSorted.length;

    if (!userState || userState.balance <= 0) {
      return { rank: null, points: 0, total_participants: total };
    }

    const idx = allSorted.findIndex(([w]) => w === norm);
    return {
      rank: idx >= 0 ? idx + 1 : null,
      points: userState.balance,
      total_participants: total,
    };
  }
}

export const getLeaderboardService = () => LeaderboardService.getInstance();
