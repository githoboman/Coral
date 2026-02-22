import { Router, Request, Response, NextFunction } from "express";
import { TicketMinter, getTicketMinter } from "../services/ticketMinter";
import { getLeaderboardService } from "../services/leaderboardService";
import { getUserManager } from "../services/userManager";
import getSupabaseClient from "../config/supabase";

const router = Router();
const supabase = getSupabaseClient();

let ticketMinter: TicketMinter | null = null;

function getLocalTicketMinter(): TicketMinter {
  if (!ticketMinter) ticketMinter = getTicketMinter();
  return ticketMinter;
}

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

// ─── Supabase helpers ────────────────────────────────────────────────

/** Get the latest check-in for a user from Supabase */
async function getLatestCheckin(userId: string): Promise<{
  lastCheckinDate: string | null;
  currentStreak: number;
  totalCheckins: number;
} | null> {
  try {
    const { data, error } = await supabase
      .from('checkins')
      .select('created_at, streak_day, points_earned')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;

    // Count total check-ins
    const { count } = await supabase
      .from('checkins')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    const lastDate = new Date(data.created_at);
    const y = lastDate.getUTCFullYear();
    const m = String(lastDate.getUTCMonth() + 1).padStart(2, "0");
    const d = String(lastDate.getUTCDate()).padStart(2, "0");

    return {
      lastCheckinDate: `${y}-${m}-${d}`,
      currentStreak: data.streak_day || 0,
      totalCheckins: count || 0,
    };
  } catch (err) {
    console.warn("[CHECKIN] Supabase lookup failed:", err);
    return null;
  }
}

/** Record a check-in to Supabase */
async function recordCheckin(
  userId: string,
  pointsEarned: number,
  streakDay: number,
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('checkins')
      .insert({
        user_id: userId,
        points_earned: pointsEarned,
        streak_day: streakDay,
      });

    if (error) {
      console.error("[CHECKIN] Failed to record check-in to Supabase:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[CHECKIN] Error recording check-in:", err);
    return false;
  }
}

// ─── Routes ──────────────────────────────────────────────────────────

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

      const timezoneOffset = timezone_offset
        ? parseInt(timezone_offset as string)
        : 0;
      const userDateToday = getUserDate(timezoneOffset);
      const yesterdayDate = getYesterdayDate(timezoneOffset);

      const minter = getLocalTicketMinter();
      const leaderboard = getLeaderboardService();

      // Try Supabase first (fast, persistent), fall back to chain (slow)
      let lastCheckinDate: string | null = null;
      let currentStreak = 0;
      let totalCheckins = 0;

      const supabaseData = await getLatestCheckin(wallet_address);

      if (supabaseData) {
        lastCheckinDate = supabaseData.lastCheckinDate;
        currentStreak = supabaseData.currentStreak;
        totalCheckins = supabaseData.totalCheckins;
      } else {
        // Fallback to on-chain reads
        console.log(`[CHECKIN] No Supabase data for ${wallet_address.slice(0, 10)}..., falling back to chain`);
        [lastCheckinDate, currentStreak, totalCheckins] = await Promise.all([
          minter.getLastCheckinDate(wallet_address),
          minter.getCurrentStreak(wallet_address),
          minter.getTotalCheckins(wallet_address),
        ]);
      }

      const [checkinFee, balance] = await Promise.all([
        getCachedCheckinFee(minter),
        Promise.resolve(leaderboard.getUserBalance(wallet_address)),
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

      res.json({
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
      });
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

      const timezoneOffset = timezone_offset || 0;
      const minter = getLocalTicketMinter();

      // Read from Supabase first, fall back to chain
      let lastCheckinDate: string | null = null;
      let currentStreak = 0;
      let checkinFee = 2_000_000;

      const supabaseData = await getLatestCheckin(wallet_address);

      if (supabaseData) {
        lastCheckinDate = supabaseData.lastCheckinDate;
        currentStreak = supabaseData.currentStreak;
        checkinFee = await getCachedCheckinFee(minter);
      } else {
        // Fallback to chain
        [lastCheckinDate, currentStreak, checkinFee] = await Promise.all([
          minter.getLastCheckinDate(wallet_address),
          minter.getCurrentStreak(wallet_address),
          minter.getCheckinFee(),
        ]);
      }

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
        `Minting check-in ticket for ${wallet_address.substring(0, 10)}...`,
      );
      console.log(
        `   Date: ${userDateToday}, Streak: ${currentStreak} -> ${nextStreak}`,
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

      console.log(`Check-in ticket minted: ${ticketObjectId}`);

      // Persist to Supabase and update leaderboard instantly
      await getLeaderboardService().creditPoints(wallet_address, pointsInfo.totalPoints);

      Promise.all([
        recordCheckin(wallet_address, pointsInfo.totalPoints, nextStreak),
        getUserManager().updateCheckinStats(
          wallet_address,
          pointsInfo.totalPoints,
          nextStreak,
          userDateToday
        )
      ]).catch(err => console.warn("[CHECKIN] Background updates failed:", err));

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
          ? `Milestone! ${pointsInfo.totalPoints} points (${pointsInfo.basePoints} + ${pointsInfo.milestoneBonus} bonus), day ${nextStreak}!`
          : `Check in to claim ${pointsInfo.totalPoints} pt${pointsInfo.totalPoints !== 1 ? "s" : ""} and continue your ${nextStreak}-day streak!`,
      });
    } catch (error) {
      console.error("Error in checkin/request-ticket:", error);
      next(error);
    }
  },
);

export default router;
