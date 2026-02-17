import { Router, Request, Response, NextFunction } from "express";
import { TicketMinter, getTicketMinter } from "../services/ticketMinter";
import { WalrusUserManager, getWalrusUserManager } from "../services/walrusUserManager";

const router = Router();

let ticketMinter: TicketMinter | null = null;
let userManager: WalrusUserManager | null = null;

function getLocalTicketMinter(): TicketMinter {
  if (!ticketMinter) ticketMinter = getTicketMinter();
  return ticketMinter;
}

function getUserManager(): WalrusUserManager {
  if (!userManager) userManager = getWalrusUserManager();
  return userManager;
}

interface StatusCache {
  data: any;
  timestamp: number;
}

const statusCache = new Map<string, StatusCache>();
const CACHE_TTL = 3000;

function getCachedStatus(walletAddress: string): any | null {
  const cached = statusCache.get(walletAddress);
  if (!cached) return null;

  const now = Date.now();
  if (now - cached.timestamp > CACHE_TTL) {
    statusCache.delete(walletAddress);
    return null;
  }

  return cached.data;
}

function setCachedStatus(walletAddress: string, data: any): void {
  statusCache.set(walletAddress, {
    data,
    timestamp: Date.now(),
  });
}

function getUserDate(timezoneOffset: number): string {
  const now = new Date();
  const userMs = now.getTime() + timezoneOffset * 60000;
  const userDate = new Date(userMs);

  const year = userDate.getUTCFullYear();
  const month = String(userDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(userDate.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getYesterdayDate(timezoneOffset: number): string {
  const now = new Date();
  const userMs = now.getTime() + timezoneOffset * 60000;
  const userDate = new Date(userMs);

  userDate.setUTCDate(userDate.getUTCDate() - 1);

  const year = userDate.getUTCFullYear();
  const month = String(userDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(userDate.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getMidnightTimestamp(timezoneOffset: number): number {
  const now = new Date();
  const userMs = now.getTime() + timezoneOffset * 60000;
  const userDate = new Date(userMs);

  userDate.setUTCHours(0, 0, 0, 0);
  userDate.setUTCDate(userDate.getUTCDate() + 1);

  return userDate.getTime() - timezoneOffset * 60000;
}

function calculateCheckinPoints(currentStreak: number): {
  basePoints: number;
  milestoneBonus: number;
  totalPoints: number;
  isMilestone: boolean;
  nextMilestone: number;
} {
  const MILESTONES = [
    5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80,
  ];
  const BASE_POINTS = 1;
  const MILESTONE_BONUS = 5;

  const isMilestone = MILESTONES.includes(currentStreak);
  const milestoneBonus = isMilestone ? MILESTONE_BONUS : 0;
  const totalPoints = BASE_POINTS + milestoneBonus;

  const nextMilestone = MILESTONES.find((m) => m > currentStreak) || 80;

  return {
    basePoints: BASE_POINTS,
    milestoneBonus,
    totalPoints,
    isMilestone,
    nextMilestone,
  };
}

import { getLeaderboardService } from "../services/leaderboardService";

// ... (keep usage of TicketMinter for fallbacks and writes)

// Cache checkin fee globally
let cachedCheckinFee: { amount: number; timestamp: number } | null = null;
const FEE_CACHE_TTL = 1000 * 60 * 60; // 1 hour

async function getCachedCheckinFee(minter: TicketMinter): Promise<number> {
  if (cachedCheckinFee && Date.now() - cachedCheckinFee.timestamp < FEE_CACHE_TTL) {
    return cachedCheckinFee.amount;
  }

  try {
    const fee = await minter.getCheckinFee();
    cachedCheckinFee = { amount: fee, timestamp: Date.now() };
    return fee;
  } catch (e) {
    console.warn("Failed to fetch checkin fee, using default");
    return 2_000_000;
  }
}

router.get(
  "/status",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { wallet_address, timezone_offset } = req.query;

      if (!wallet_address || typeof wallet_address !== "string") {
        res.status(400).json({
          error: "Bad Request",
          detail: "wallet_address is required",
        });
        return;
      }

      // 1. Try serving from short-term API cache (highest speed)
      const cached = getCachedStatus(wallet_address);
      if (cached) {
        // console.log(`💨 Serving cached status for ${wallet_address.substring(0, 10)}...`);
        res.json(cached);
        return;
      }

      const timezoneOffset = timezone_offset
        ? parseInt(timezone_offset as string)
        : 0;

      const minter = getLocalTicketMinter();
      const userManager = getUserManager();
      const leaderboard = getLeaderboardService();

      // 2. Fetch data parallelly/from cache
      // A. Checkin Fee (Global Cache)
      const checkinFeePromise = getCachedCheckinFee(minter);

      // B. User Balance (Leaderboard Memory Cache - Instant)
      // Leaderboard service updates in background, so this is non-blocking
      const balance = leaderboard.getUserBalance(wallet_address);

      // C. User Profile Stats (Walrus Registry - Disk Cache - Instant)
      let lastCheckinDate = "";
      let currentStreak = 0;
      let totalCheckins = 0;

      try {
        const blobId = await minter.getCurrentBlobId(); // Cached 10s
        if (blobId) {
          const profile = await userManager.getUserProfile(blobId, wallet_address); // Cached
          if (profile) {
            lastCheckinDate = profile.last_checkin_date || "";
            currentStreak = profile.current_streak || 0;
            totalCheckins = profile.total_checkins || 0;
          }
        }
      } catch (err) {
        console.warn("Error fetching profile for checkin status, falling back to chain:", err);
        // Fallback to chain if profile fails? 
        // Or just assume 0 if we assume registry is source of truth.
        // Let's do a quick chain fallback if missing, to be safe.
        currentStreak = await minter.getCurrentStreak(wallet_address);
      }

      const checkinFee = await checkinFeePromise;

      // ... (Rest of logic: calculations)

      const userDateToday = getUserDate(timezoneOffset);
      const yesterdayDate = getYesterdayDate(timezoneOffset);

      const canCheckin = lastCheckinDate !== userDateToday;

      let nextAvailableMs: number | null = null;
      let hoursRemaining: number | null = null;
      let streakWillReset = false;
      let nextStreak = 1;

      if (!canCheckin) {
        const midnightMs = getMidnightTimestamp(timezoneOffset);
        const now = Date.now();
        const timeRemainingMs = midnightMs - now;
        hoursRemaining = Math.ceil(timeRemainingMs / (1000 * 60 * 60));
        nextAvailableMs = midnightMs;
        nextStreak = currentStreak + 1;
      } else {
        if (lastCheckinDate) {
          if (lastCheckinDate === yesterdayDate) {
            nextStreak = currentStreak + 1;
            streakWillReset = false;
          } else {
            nextStreak = 1;
            streakWillReset = currentStreak > 0;
          }
        } else {
          nextStreak = 1;
          streakWillReset = false;
        }
      }

      const pointsInfo = calculateCheckinPoints(nextStreak);

      const response = {
        can_checkin: canCheckin,
        last_checkin_date: lastCheckinDate || null,
        last_checkin_at: lastCheckinDate
          ? new Date(lastCheckinDate).getTime()
          : null,
        next_available_at: nextAvailableMs,
        hours_remaining: hoursRemaining,
        balance, // From Leaderboard
        current_streak: currentStreak,
        total_checkins: totalCheckins,
        next_streak: nextStreak,
        streak_will_reset: streakWillReset,
        next_checkin_points: pointsInfo.totalPoints,
        next_is_milestone: pointsInfo.isMilestone,
        next_milestone: pointsInfo.nextMilestone,
        days_to_next_milestone: pointsInfo.nextMilestone - nextStreak,
        checkin_fee: checkinFee,
      };

      setCachedStatus(wallet_address, response);

      res.json(response);
    } catch (error) {
      console.error("Error in checkin/status:", error);
      next(error);
    }
  },
);

router.post(
  "/request-ticket",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { wallet_address, timezone_offset } = req.body;

      if (!wallet_address || typeof wallet_address !== "string") {
        res.status(400).json({
          error: "Bad Request",
          detail: "wallet_address is required",
        });
        return;
      }

      statusCache.delete(wallet_address);

      const timezoneOffset = timezone_offset || 0;
      const minter = getLocalTicketMinter();

      const lastCheckinDate = await minter.getLastCheckinDate(wallet_address);
      const currentStreak = await minter.getCurrentStreak(wallet_address);
      const checkinFee = await minter.getCheckinFee();

      const userDateToday = getUserDate(timezoneOffset);
      const yesterdayDate = getYesterdayDate(timezoneOffset);

      if (lastCheckinDate === userDateToday) {
        const midnightMs = getMidnightTimestamp(timezoneOffset);
        const now = Date.now();
        const hoursRemaining = Math.ceil((midnightMs - now) / (1000 * 60 * 60));

        res.json({
          success: false,
          can_checkin: false,
          hours_remaining: hoursRemaining,
          message: `You've already checked in today. Next check-in available at midnight (in ${hoursRemaining}h).`,
        });
        return;
      }

      let nextStreak = 1;
      if (lastCheckinDate) {
        if (lastCheckinDate === yesterdayDate) {
          nextStreak = currentStreak + 1;
        } else {
          nextStreak = 1;
        }
      }

      const pointsInfo = calculateCheckinPoints(nextStreak);

      console.log(
        `🎟️  Minting check-in ticket for ${wallet_address.substring(0, 10)}...`,
      );
      console.log(`   Date: ${userDateToday}`);
      console.log(`   Current streak: ${currentStreak} → Next: ${nextStreak}`);
      console.log(
        `   Points: ${pointsInfo.totalPoints} (base: ${pointsInfo.basePoints}, bonus: ${pointsInfo.milestoneBonus})`,
      );
      console.log(`   Is milestone: ${pointsInfo.isMilestone}`);
      console.log(
        `   Fee: ${checkinFee} MIST (${(checkinFee / 1_000_000_000).toFixed(3)} SUI)`,
      );

      const ticketObjectId = await minter.mintCheckinTicket(
        wallet_address,
        pointsInfo.totalPoints,
        userDateToday,
      );

      if (!ticketObjectId) {
        res.status(500).json({
          error: "Internal Server Error",
          detail: "Failed to mint check-in ticket. Please try again.",
        });
        return;
      }

      console.log(`✅ Check-in ticket minted: ${ticketObjectId}`);

      (async () => {
        try {
          const blobRegistry = await minter.getCurrentBlobId();
          if (blobRegistry) {
            const existingProfile = await getUserManager().getUserProfile(
              blobRegistry,
              wallet_address,
            );
            if (existingProfile) {
              const updatedProfile = getUserManager().createUserProfile(
                existingProfile.email,
                existingProfile.wallet_address,
                existingProfile.is_waitlisted,
                existingProfile.points_awarded,
                {
                  ...existingProfile,
                  current_streak: nextStreak,
                  last_checkin_date: userDateToday,
                  total_checkins: (existingProfile.total_checkins || 0) + 1,
                },
              );

              const newBlobId = await getUserManager().addOrUpdateUser(
                blobRegistry,
                updatedProfile,
              );
              if (newBlobId && newBlobId !== blobRegistry) {
                await minter.updateBlobRegistry(newBlobId);
                console.log(
                  `📦 Streak data backed up to Walrus → ${newBlobId}`,
                );
              }
            }
          }
        } catch (walrusErr) {
          console.warn(
            "⚠️  Walrus streak backup failed (non-fatal):",
            walrusErr,
          );
        }
      })();

      res.json({
        success: true,
        ticket_object_id: ticketObjectId,
        checkin_date: userDateToday,
        points_amount: pointsInfo.totalPoints,
        base_points: pointsInfo.basePoints,
        milestone_bonus: pointsInfo.milestoneBonus,
        is_milestone: pointsInfo.isMilestone,
        new_streak: nextStreak,
        next_milestone: pointsInfo.nextMilestone,
        checkin_fee: checkinFee,
        message: pointsInfo.isMilestone
          ? `🎉 Milestone! Check in to claim ${pointsInfo.totalPoints} points (${pointsInfo.basePoints} + ${pointsInfo.milestoneBonus} bonus) and reach day ${nextStreak}! Fee: ${(checkinFee / 1_000_000_000).toFixed(3)} SUI`
          : `Check in to claim ${pointsInfo.totalPoints} point${pointsInfo.totalPoints !== 1 ? "s" : ""} and continue your ${nextStreak}-day streak! Fee: ${(checkinFee / 1_000_000_000).toFixed(3)} SUI`,
      });
    } catch (error) {
      console.error("Error in checkin/request-ticket:", error);
      next(error);
    }
  },
);

export default router;
