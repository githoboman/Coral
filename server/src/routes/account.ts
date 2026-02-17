import { Router, Request, Response, NextFunction } from "express";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import {
  WalrusUserManager,
  getWalrusUserManager,
} from "../services/walrusUserManager";
import { TicketMinter, getTicketMinter } from "../services/ticketMinter";

const router = Router();

let userManager: WalrusUserManager | null = null;
let ticketMinter: TicketMinter | null = null;

function getUserManager(): WalrusUserManager {
  if (!userManager) userManager = getWalrusUserManager();
  return userManager;
}
function getLocalTicketMinter(): TicketMinter {
  if (!ticketMinter) ticketMinter = getTicketMinter();
  return ticketMinter;
}

const network = (process.env.SUI_NETWORK || "testnet") as "testnet" | "mainnet";
const suiClient = new SuiClient({ url: getFullnodeUrl(network) });
const PACKAGE_ID = process.env.SUI_PACKAGE_ID || "";

const normalizeAddr = (addr: string): string =>
  "0x" + (addr.startsWith("0x") ? addr.slice(2) : addr).padStart(64, "0");

export async function getBalanceFromEvents(
  walletAddress: string,
): Promise<number> {
  if (!PACKAGE_ID) return 0;

  const target = normalizeAddr(walletAddress);
  let bestBalance = 0;
  let bestTs = 0;

  const updateBest = (
    events: any[],
    balanceField: string,
    walletField: string,
  ) => {
    for (const ev of events) {
      const data = ev.parsedJson as any;
      if (!data) continue;
      if (normalizeAddr(data[walletField] || "") !== target) continue;
      const balance = parseInt(data[balanceField] || "0", 10);
      const ts = parseInt(data.timestamp || "0", 10);
      if (ts > bestTs || (ts === bestTs && balance > bestBalance)) {
        bestBalance = balance;
        bestTs = ts;
      }
    }
  };

  try {
    const page = await suiClient.queryEvents({
      query: { MoveEventType: `${PACKAGE_ID}::points::PointsClaimed` },
      limit: 50,
      order: "descending",
    });
    updateBest(page.data, "new_balance", "wallet_address");
  } catch (err) {
    console.warn("[BALANCE] Error fetching PointsClaimed:", err);
  }

  try {
    const page = await suiClient.queryEvents({
      query: { MoveEventType: `${PACKAGE_ID}::task_points::TaskPointsClaimed` },
      limit: 50,
      order: "descending",
    });
    updateBest(page.data, "new_balance", "wallet_address");
  } catch (err) {
    console.warn("[BALANCE] Error fetching TaskPointsClaimed:", err);
  }

  return bestBalance;
}

interface LeaderboardEntry {
  rank: number;
  user_id: string;
  wallet_address: string;
  username?: string;
  points: number;
  referral_points: number;
}

interface LeaderboardCache {
  entries: LeaderboardEntry[];
  builtAt: number;
}

let leaderboardCache: LeaderboardCache | null = null;
const LEADERBOARD_CACHE_TTL = 3 * 60 * 1000;
let buildingLeaderboard = false;

async function buildLeaderboardFromChain(): Promise<LeaderboardEntry[]> {
  if (!PACKAGE_ID) {
    console.warn("[LEADERBOARD] SUI_PACKAGE_ID not set, returning empty");
    return [];
  }

  console.log("[LEADERBOARD] Building from blockchain events...");

  const balanceMap = new Map<string, { balance: number; ts: number }>();

  const processEvents = (
    events: any[],
    balanceField: string,
    walletField: string,
  ) => {
    for (const ev of events) {
      const data = ev.parsedJson as any;
      if (!data) continue;
      const wallet = normalizeAddr(data[walletField] || "");
      const balance = parseInt(data[balanceField] || "0", 10);
      const ts = parseInt(data.timestamp || "0", 10);
      const existing = balanceMap.get(wallet);
      if (
        !existing ||
        ts > existing.ts ||
        (ts === existing.ts && balance > existing.balance)
      ) {
        balanceMap.set(wallet, { balance, ts });
      }
    }
  };

  try {
    let cursor: string | undefined = undefined;
    let hasNext = true;
    while (hasNext) {
      const page = await suiClient.queryEvents({
        query: { MoveEventType: `${PACKAGE_ID}::points::PointsClaimed` },
        cursor,
        limit: 50,
        order: "descending",
      });
      processEvents(page.data, "new_balance", "wallet_address");
      hasNext = page.hasNextPage;
      cursor = page.nextCursor ?? undefined;
      if (!hasNext || !cursor) break;
    }
  } catch (err) {
    console.warn("[LEADERBOARD] Error fetching PointsClaimed:", err);
  }

  try {
    let cursor: string | undefined = undefined;
    let hasNext = true;
    while (hasNext) {
      const page = await suiClient.queryEvents({
        query: {
          MoveEventType: `${PACKAGE_ID}::task_points::TaskPointsClaimed`,
        },
        cursor,
        limit: 50,
        order: "descending",
      });
      processEvents(page.data, "new_balance", "wallet_address");
      hasNext = page.hasNextPage;
      cursor = page.nextCursor ?? undefined;
      if (!hasNext || !cursor) break;
    }
  } catch (err) {
    console.warn("[LEADERBOARD] Error fetching TaskPointsClaimed:", err);
  }

  const sorted = Array.from(balanceMap.entries())
    .filter(([, { balance }]) => balance > 0)
    .sort((a, b) => b[1].balance - a[1].balance);

  const relevantWallets = new Set(sorted.map(([w]) => w));
  const usernameMap = new Map<string, string>();
  try {
    const minter = getLocalTicketMinter();
    const blobId = await minter.getCurrentBlobId();
    if (blobId) {
      const um = getUserManager();
      const registry = await um.fetchUsersRegistry(blobId);
      if (registry) {
        for (const wallet of Object.keys(registry.users)) {
          const norm = normalizeAddr(wallet);
          if (!relevantWallets.has(norm)) continue;
          try {
            const profile = await um.getUserProfile(blobId, wallet);
            if (profile?.username) usernameMap.set(norm, profile.username);
          } catch {}
        }
      }
    }
  } catch (err) {
    console.warn("[LEADERBOARD] Username enrichment failed (non-fatal):", err);
  }

  return sorted
    .slice(0, 100)
    .map(([wallet, { balance }], idx) => ({
      rank: idx + 1,
      user_id: wallet,
      wallet_address: wallet,
      username: usernameMap.get(wallet),
      points: balance,
      referral_points: 0,
    }));
}

router.get(
  "/account/:user_id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { user_id } = req.params;

      if (!user_id?.trim()) {
        return res
          .status(400)
          .json({ error: "Bad Request", detail: "User ID cannot be empty" });
      }
      if (!user_id.startsWith("0x") || user_id.length !== 66) {
        return res.status(400).json({
          error: "Bad Request",
          detail: "Invalid wallet address format",
        });
      }

      const minter = getLocalTicketMinter();
      const blobId = await minter.getCurrentBlobId();

      if (!blobId) {
        return res.status(404).json({
          error: "Not Found",
          detail: "User registry not initialized",
        });
      }

      const um = getUserManager();
      const userProfile = await um.getUserProfile(blobId, user_id);

      if (!userProfile) {
        return res
          .status(404)
          .json({ error: "Not Found", detail: "User not found" });
      }

      const balance = await getBalanceFromEvents(user_id);

      return res.json({
        user_id,
        wallet_address: userProfile.wallet_address,
        email: userProfile.email,
        username: userProfile.username,
        first_name: userProfile.first_name,
        last_name: userProfile.last_name,
        points: balance,
        referral_points: 0,
        rank: null,
        is_premium: userProfile.subscription_tier === 1,
        subscription_tier: userProfile.subscription_tier || 0,
        subscription_expires_at: userProfile.subscription_expires_at,
        created_at: userProfile.joined_at,
        tasks_created_today: userProfile.tasks_created_today || 0,
        tasks_claimed_today: userProfile.tasks_claimed_today || 0,
      });
    } catch (error) {
      console.error("Error fetching account:", error);
      next(error);
    }
  },
);

router.get(
  "/leaderboard",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const forceRefresh = req.query.refresh === "true";

      if (
        !forceRefresh &&
        leaderboardCache &&
        Date.now() - leaderboardCache.builtAt < LEADERBOARD_CACHE_TTL
      ) {
        console.log(
          `[LEADERBOARD] Cached (${leaderboardCache.entries.length} entries, ` +
            `${Math.round((Date.now() - leaderboardCache.builtAt) / 1000)}s old)`,
        );
        return res.json({ leaderboard: leaderboardCache.entries });
      }

      if (buildingLeaderboard) {
        console.log("[LEADERBOARD] Build in progress, serving stale cache");
        if (leaderboardCache) {
          return res.json({ leaderboard: leaderboardCache.entries });
        }
        const deadline = Date.now() + 8000;
        while (buildingLeaderboard && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 200));
        }
        return res.json({ leaderboard: leaderboardCache?.entries ?? [] });
      }

      buildingLeaderboard = true;
      try {
        const entries = await buildLeaderboardFromChain();
        leaderboardCache = { entries, builtAt: Date.now() };
        console.log(`[LEADERBOARD] Built ${entries.length} entries`);
        return res.json({ leaderboard: entries });
      } finally {
        buildingLeaderboard = false;
      }
    } catch (error) {
      console.error("[LEADERBOARD] Error:", error);
      if (leaderboardCache) {
        return res.json({ leaderboard: leaderboardCache.entries });
      }
      next(error);
    }
  },
);

export default router;
