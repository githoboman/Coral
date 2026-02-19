import { Router, Request, Response, NextFunction } from "express";
import { TicketMinter, getTicketMinter } from "../services/ticketMinter";

const router = Router();

let ticketMinter: TicketMinter | null = null;

function getLocalTicketMinter(): TicketMinter {
  if (!ticketMinter) ticketMinter = getTicketMinter();
  return ticketMinter;
}

interface StatusCache {
  data: any;
  timestamp: number;
}

const statusCache = new Map<string, StatusCache>();
const CACHE_TTL = 3_000;

function getCachedStatus(walletAddress: string): any | null {
  const cached = statusCache.get(walletAddress);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CACHE_TTL) {
    statusCache.delete(walletAddress);
    return null;
  }
  return cached.data;
}

function setCachedStatus(walletAddress: string, data: any): void {
  statusCache.set(walletAddress, { data, timestamp: Date.now() });
}

interface RecentCheckin {
  date: string;
  streak: number;
  totalCheckins: number;
  timestamp: number;
}

const recentCheckinCache = new Map<string, RecentCheckin>();
const RECENT_CHECKIN_TTL = 5 * 60 * 1_000; // 5 minutes

let cachedCheckinFee: { amount: number; timestamp: number } | null = null;
const FEE_CACHE_TTL = 60 * 60 * 1_000;

async function getCachedCheckinFee(minter: TicketMinter): Promise<number> {
  if (
    cachedCheckinFee &&
    Date.now() - cachedCheckinFee.timestamp < FEE_CACHE_TTL
  ) {
    return cachedCheckinFee.amount;
  }
  try {
    const fee = await minter.getCheckinFee();
    cachedCheckinFee = { amount: fee, timestamp: Date.now() };
    return fee;
  } catch {
    console.warn("Failed to fetch checkin fee, using default");
    return 2_000_000;
  }
}

function getUserDate(timezoneOffset: number): string {
  const now = new Date();
  const userMs = now.getTime() + timezoneOffset * 60_000;
  const d = new Date(userMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getYesterdayDate(timezoneOffset: number): string {
  const now = new Date();
  const userMs = now.getTime() + timezoneOffset * 60_000;
  const d = new Date(userMs);
  d.setUTCDate(d.getUTCDate() - 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getMidnightTimestamp(timezoneOffset: number): number {
  const now = new Date();
  const userMs = now.getTime() + timezoneOffset * 60_000;
  const d = new Date(userMs);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.getTime() - timezoneOffset * 60_000;
}

const MILESTONES = [
  5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80,
];

function calculateCheckinPoints(currentStreak: number) {
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

router.get(
  "/status",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { wallet_address, timezone_offset } = req.query;

      if (!wallet_address || typeof wallet_address !== "string") {
        res
          .status(400)
          .json({ error: "Bad Request", detail: "wallet_address is required" });
        return;
      }

      const cached = getCachedStatus(wallet_address);
      if (cached) {
        res.json(cached);
        return;
      }

      const timezoneOffset = timezone_offset
        ? parseInt(timezone_offset as string)
        : 0;
      const userDateToday = getUserDate(timezoneOffset);
      const yesterdayDate = getYesterdayDate(timezoneOffset);

      const minter = getLocalTicketMinter();
      const leaderboard = getLeaderboardService();

      const recent = recentCheckinCache.get(wallet_address);
      const recentIsValid =
        recent &&
        Date.now() - recent.timestamp < RECENT_CHECKIN_TTL &&
        recent.date === userDateToday;

      const [
        checkinFee,
        balance,
        lastCheckinDate,
        currentStreak,
        totalCheckins,
      ] = await Promise.all([
        getCachedCheckinFee(minter),
        Promise.resolve(leaderboard.getUserBalance(wallet_address)),
        recentIsValid
          ? Promise.resolve(recent!.date)
          : minter.getLastCheckinDate(wallet_address),
        recentIsValid
          ? Promise.resolve(recent!.streak)
          : minter.getCurrentStreak(wallet_address),
        recentIsValid
          ? Promise.resolve(recent!.totalCheckins)
          : minter.getTotalCheckins(wallet_address),
      ]);

      const canCheckin = lastCheckinDate !== userDateToday;

      let nextAvailableMs: number | null = null;
      let hoursRemaining: number | null = null;
      let nextStreak = 1;
      let streakWillReset = false;

      if (!canCheckin) {
        const midnightMs = getMidnightTimestamp(timezoneOffset);
        hoursRemaining = Math.ceil(
          (midnightMs - Date.now()) / (1_000 * 60 * 60),
        );
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
        balance,
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
        res
          .status(400)
          .json({ error: "Bad Request", detail: "wallet_address is required" });
        return;
      }

      // Clear caches so next /status call is fresh
      statusCache.delete(wallet_address);
      recentCheckinCache.delete(wallet_address);

      const timezoneOffset = timezone_offset || 0;
      const minter = getLocalTicketMinter();

      // Read everything from chain — no Walrus
      const [lastCheckinDate, currentStreak, checkinFee] = await Promise.all([
        minter.getLastCheckinDate(wallet_address),
        minter.getCurrentStreak(wallet_address),
        minter.getCheckinFee(),
      ]);

      const userDateToday = getUserDate(timezoneOffset);
      const yesterdayDate = getYesterdayDate(timezoneOffset);

      if (lastCheckinDate === userDateToday) {
        const midnightMs = getMidnightTimestamp(timezoneOffset);
        const hoursRemaining = Math.ceil(
          (midnightMs - Date.now()) / (1_000 * 60 * 60),
        );
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
        nextStreak = lastCheckinDate === yesterdayDate ? currentStreak + 1 : 1;
      }

      const pointsInfo = calculateCheckinPoints(nextStreak);

      console.log(
        `🎟️  Minting check-in ticket for ${wallet_address.substring(0, 10)}...`,
      );
      console.log(
        `   Date: ${userDateToday}, Streak: ${currentStreak} → ${nextStreak}`,
      );
      console.log(
        `   Points: ${pointsInfo.totalPoints}, Milestone: ${pointsInfo.isMilestone}`,
      );

      const ticketObjectId = await minter.mintCheckinTicket(
        wallet_address,
        pointsInfo.totalPoints,
        userDateToday,
      );

      if (!ticketObjectId) {
        res.status(500).json({
          error: "Internal Server Error",
          detail: "Failed to mint check-in ticket.",
        });
        return;
      }

      console.log(`✅ Check-in ticket minted: ${ticketObjectId}`);

      recentCheckinCache.set(wallet_address, {
        date: userDateToday,
        streak: nextStreak,
        totalCheckins: 0,
        timestamp: Date.now(),
      });

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
          ? `🎉 Milestone! ${pointsInfo.totalPoints} points (${pointsInfo.basePoints} + ${pointsInfo.milestoneBonus} bonus), day ${nextStreak}!`
          : `Check in to claim ${pointsInfo.totalPoints} pt${pointsInfo.totalPoints !== 1 ? "s" : ""} and continue your ${nextStreak}-day streak!`,
      });
    } catch (error) {
      console.error("Error in checkin/request-ticket:", error);
      next(error);
    }
  },
);

export default router;
