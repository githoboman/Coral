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
  if (cachedCheckinFee && Date.now() - cachedCheckinFee.timestamp < FEE_CACHE_TTL) {
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

// ─── Timezone helpers ─────────────────────────────────────────────────────────

/**
 * Clamp timezone offset to the real-world range (-720 to +840 minutes).
 * Prevents clients from spoofing an offset to manufacture a new calendar day.
 */
function sanitizeOffset(raw: unknown): number {
  const n = parseInt(raw as string) || 0;
  return Math.max(-720, Math.min(840, n));
}

/** "YYYY-MM-DD" in the user's local timezone */
function localDateString(date: Date, tzOffset: number): string {
  const localMs = date.getTime() + tzOffset * 60_000;
  const d = new Date(localMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** "YYYY-MM-DD" for yesterday in the user's local timezone */
function localYesterdayString(tzOffset: number): string {
  const now = new Date();
  const todayLocalMs = now.getTime() + tzOffset * 60_000;
  const yesterdayLocalMs = todayLocalMs - 24 * 60 * 60 * 1_000;
  const d = new Date(yesterdayLocalMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Unix ms of next midnight in the user's local timezone */
function nextLocalMidnightMs(tzOffset: number): number {
  const localMs = Date.now() + tzOffset * 60_000;
  const d = new Date(localMs);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 1); // roll to tomorrow 00:00 local
  return d.getTime() - tzOffset * 60_000; // convert back to UTC ms
}

// ─── Milestones & points ──────────────────────────────────────────────────────

const MILESTONES = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80];

function calculateCheckinPoints(streak: number) {
  const BASE_POINTS = 1;
  const MILESTONE_BONUS = 5;
  const isMilestone = MILESTONES.includes(streak);
  const milestoneBonus = isMilestone ? MILESTONE_BONUS : 0;
  const totalPoints = BASE_POINTS + milestoneBonus;
  const nextMilestone = MILESTONES.find((m) => m > streak) ?? 80;
  return { basePoints: BASE_POINTS, milestoneBonus, totalPoints, isMilestone, nextMilestone };
}

// ─── Streak logic (calendar-day, user's timezone) ─────────────────────────────

interface StreakResult {
  nextStreak: number;
  streakWillReset: boolean;
}

/**
 * Determines the next streak value using calendar-day comparison in the
 * user's own timezone.
 *
 * `lastCheckinDate` is the "YYYY-MM-DD" string stored at check-in time
 * (in that check-in's timezone). We compare it against today and yesterday
 * in the current request's timezone.
 *
 * Rules:
 *   - lastCheckinDate === yesterday → consecutive day, streak continues
 *   - lastCheckinDate === today     → same day (cooldown), streak unchanged
 *   - anything older               → missed a day, streak resets to 1
 */
function computeNextStreak(
  lastCheckinDate: string | null,
  currentStreak: number,
  tzOffset: number,
): StreakResult {
  if (!lastCheckinDate) {
    return { nextStreak: 1, streakWillReset: false };
  }

  const today = localDateString(new Date(), tzOffset);
  const yesterday = localYesterdayString(tzOffset);

  if (lastCheckinDate === yesterday) {
    return { nextStreak: currentStreak + 1, streakWillReset: false };
  }

  if (lastCheckinDate === today) {
    // Already checked in today — caller should have blocked this before
    // reaching computeNextStreak, but handle gracefully just in case.
    return { nextStreak: currentStreak, streakWillReset: false };
  }

  // Missed one or more days
  return { nextStreak: 1, streakWillReset: currentStreak > 0 };
}

// ─── Supabase helpers ─────────────────────────────────────────────────────────

interface CheckinRecord {
  lastCheckinDate: string | null; // "YYYY-MM-DD" stored at check-in time
  lastCheckinAt: number | null;   // epoch ms
  currentStreak: number;
  totalCheckins: number;
}

/**
 * Reads the latest check-in from Supabase.
 *
 * `checkin_date` is the canonical source — it stores the calendar date in
 * the user's local timezone at the moment of check-in.
 *
 * Fallback: if `checkin_date` is NULL (rows written before the column was
 * added), we derive a UTC date string from `created_at`. This is safe because
 * `checkins.streak_day` was always written correctly, so streak math is still
 * accurate even for legacy rows.
 */
async function getLatestCheckin(userId: string, tzOffset: number): Promise<CheckinRecord | null> {
  try {
    const normalizedId = userId.toLowerCase();
    const { data, error } = await supabase
      .from("checkins")
      .select("created_at, checkin_date, streak_day")
      .eq("user_id", normalizedId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      // If no check-ins in historical table, check user_profiles for legacy/synced streak
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("last_checkin, checkin_streak, total_checkins")
        .eq("wallet_address", normalizedId)
        .maybeSingle();

      if (!profile || !profile.last_checkin) return null;

      return {
        lastCheckinDate: profile.last_checkin,
        lastCheckinAt: new Date(profile.last_checkin).getTime(),
        currentStreak: profile.checkin_streak || 0,
        totalCheckins: profile.total_checkins || 0,
      };
    }

    const { count } = await supabase
      .from("checkins")
      .select("*", { count: "exact", head: true })
      .eq("user_id", normalizedId);

    const lastCheckinAt = new Date(data.created_at).getTime();

    // Prefer stored checkin_date; fall back to calculated local date from created_at
    const lastCheckinDate =
      (data.checkin_date as string | null) ??
      localDateString(new Date(data.created_at), tzOffset);

    return {
      lastCheckinDate,
      lastCheckinAt,
      currentStreak: data.streak_day || 0,
      totalCheckins: count || 0,
    };
  } catch (err) {
    console.warn("[CHECKIN] Supabase lookup failed:", err);
    return null;
  }
}

async function recordCheckin(
  userId: string,
  pointsEarned: number,
  streakDay: number,
  checkinDate: string, // "YYYY-MM-DD" in user's local tz
  tzOffset: number,
): Promise<boolean> {
  try {
    const { error } = await supabase.from("checkins").insert({
      user_id: userId,
      points_earned: pointsEarned,
      streak_day: streakDay,
      checkin_date: checkinDate,   // always persist local calendar date
      timezone_offset: tzOffset,   // store for auditability
    });

    if (error) {
      console.error("[CHECKIN] Failed to record check-in:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[CHECKIN] Error recording check-in:", err);
    return false;
  }
}

/**
 * Checks if a check-in already exists for the specific calendar date.
 * This is the ultimate source of truth to prevent the "timezone hop" exploit.
 */
async function hasCheckinForDate(userId: string, dateStr: string): Promise<boolean> {
  try {
    const normalizedId = userId.toLowerCase();
    const { count, error } = await supabase
      .from("checkins")
      .select("*", { count: "exact", head: true })
      .eq("user_id", normalizedId)
      .eq("checkin_date", dateStr);

    if (error) throw error;
    if ((count || 0) > 0) return true;

    // Also check user_profiles.last_checkin as a backup
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("last_checkin")
      .eq("wallet_address", normalizedId)
      .maybeSingle();

    return profile?.last_checkin === dateStr;
  } catch (err) {
    console.warn(`[CHECKIN] Failed to check for existing date ${dateStr}:`, err);
    return false;
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get(
  "/status",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { wallet_address, timezone_offset } = req.query;

      if (!wallet_address || typeof wallet_address !== "string") {
        res.status(400).json({ error: "Bad Request", detail: "wallet_address is required" });
        return;
      }

      const userId = wallet_address.toLowerCase();
      const tzOffset = sanitizeOffset(timezone_offset);
      const todayDate = localDateString(new Date(), tzOffset);

      const minter = getLocalTicketMinter();
      const leaderboard = getLeaderboardService();

      let lastCheckinDate: string | null = null;
      let lastCheckinAt: number | null = null;
      let currentStreak = 0;
      let totalCheckins = 0;

      const dbData = await getLatestCheckin(userId, tzOffset);
      if (dbData) {
        ({ lastCheckinDate, lastCheckinAt, currentStreak, totalCheckins } = dbData);
      } else {
        // On-chain fallback for wallets with no Supabase rows yet
        console.log(`[CHECKIN] No Supabase data for ${userId.slice(0, 10)}..., falling back to chain`);
        const [dateStr, streak, total] = await Promise.all([
          minter.getLastCheckinDate(userId),
          minter.getCurrentStreak(userId),
          minter.getTotalCheckins(userId),
        ]);
        lastCheckinDate = dateStr;
        lastCheckinAt = dateStr ? new Date(dateStr).getTime() : null;
        currentStreak = streak;
        totalCheckins = total;
      }

      const [checkinFee, balance, alreadyCheckedInToday] = await Promise.all([
        getCachedCheckinFee(minter),
        Promise.resolve(leaderboard.getUserBalance(userId)),
        hasCheckinForDate(userId, todayDate),
      ]);

      // Can check in if:
      // 1. They haven't checked in for this local date yet.
      // 2. This local date is NOT in the past relative to their last check-in (prevents time travel).
      const isPastDate = lastCheckinDate ? (todayDate < lastCheckinDate) : false;
      const canCheckin = !alreadyCheckedInToday && !isPastDate;

      const nextAvailableMs = canCheckin ? null : nextLocalMidnightMs(tzOffset);
      const hoursRemaining = (!canCheckin && nextAvailableMs)
        ? Math.max(0, Math.ceil((nextAvailableMs - Date.now()) / (60 * 60 * 1_000)))
        : null;

      const { nextStreak, streakWillReset } = computeNextStreak(lastCheckinDate, currentStreak, tzOffset);
      const pointsInfo = calculateCheckinPoints(nextStreak);

      res.json({
        can_checkin: canCheckin,
        last_checkin_date: lastCheckinDate,
        last_checkin_at: lastCheckinAt,
        next_available_at: nextAvailableMs,
        hours_remaining: hoursRemaining,
        is_past_date: isPastDate,
        already_checked_in: alreadyCheckedInToday,
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

/**
 * POST /request-ticket (and legacy /perform)
 * Handles both gasless (instant credit) and ticket-based (minting Sui object) check-ins.
 * PC clients (next-app) expect a ticket_object_id to sign on-chain.
 * Mobile/legacy clients (app) expect instant success.
 */
const handleCheckin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { wallet_address, timezone_offset } = req.body;

    if (!wallet_address || typeof wallet_address !== "string") {
      res.status(400).json({ error: "Bad Request", detail: "wallet_address is required" });
      return;
    }

    const userId = wallet_address.toLowerCase();
    const tzOffset = sanitizeOffset(timezone_offset);
    const todayDate = localDateString(new Date(), tzOffset);
    const minter = getLocalTicketMinter();

    let lastCheckinDate: string | null = null;
    let lastCheckinAt: number | null = null;
    let currentStreak = 0;

    const dbData = await getLatestCheckin(userId, tzOffset);
    if (dbData) {
      ({ lastCheckinDate, lastCheckinAt, currentStreak } = dbData);
    } else {
      const [dateStr, streak] = await Promise.all([
        minter.getLastCheckinDate(userId),
        minter.getCurrentStreak(userId),
      ]);
      lastCheckinDate = dateStr;
      currentStreak = streak;
    }

    // Exploit Guard 1: Already checked in for this local calendar date?
    const alreadyCheckedIn = await hasCheckinForDate(userId, todayDate);
    if (alreadyCheckedIn || lastCheckinDate === todayDate) {
      const nextAvailableMs = nextLocalMidnightMs(tzOffset);
      const hoursRemaining = Math.max(0, Math.ceil((nextAvailableMs - Date.now()) / (60 * 60 * 1_000)));
      res.json({
        success: false,
        can_checkin: false,
        hours_remaining: hoursRemaining,
        message: `Already checked in for ${todayDate}. Next check-in available at midnight (in ${hoursRemaining}h).`,
      });
      return;
    }

    // Exploit Guard 2: Time travel? (Today's date is before the last check-in date)
    if (lastCheckinDate && todayDate < lastCheckinDate) {
      res.json({
        success: false,
        can_checkin: false,
        message: `Invalid check-in date (${todayDate}). You have already checked in for a future date (${lastCheckinDate}).`,
      });
      return;
    }

    const { nextStreak } = computeNextStreak(lastCheckinDate, currentStreak, tzOffset);
    const pointsInfo = calculateCheckinPoints(nextStreak);

    console.log(`[CHECKIN] Processing check-in for ${userId.slice(0, 10)}...`);
    console.log(`[CHECKIN] Date: ${todayDate} | Streak: ${currentStreak} → ${nextStreak} | Points: ${pointsInfo.totalPoints}`);

    // If the client expects a ticket (like next-app), we mint one.
    // If they don't explicitly require it, we handle it gaslessly as a fallback.
    // However, to keep it robust, we'll ALWAYS credit points to be safe, 
    // and ONLY mint a ticket if possible.
    
    let ticketId: string | null = null;
    try {
      ticketId = await minter.mintCheckinTicket(userId, pointsInfo.totalPoints, todayDate);
    } catch (mintErr) {
      console.warn("[CHECKIN] Ticket minting failed, falling back to gasless-only credit:", mintErr);
    }

    // Credit points in leaderboard instantly
    await getLeaderboardService().creditPoints(userId, pointsInfo.totalPoints);

    try {
      await Promise.all([
        recordCheckin(userId, pointsInfo.totalPoints, nextStreak, todayDate, tzOffset),
        getUserManager().updateCheckinStats(userId, pointsInfo.totalPoints, nextStreak, todayDate),
      ]);
    } catch (err) {
      console.warn("[CHECKIN] Database updates failed:", err);
      // We don't throw here because points were already credited and potentially a ticket minted.
    }

    const newBalance = await getLeaderboardService().getUserBalance(userId);

    res.json({
      success: true,
      checkin_date: todayDate,
      points_earned: pointsInfo.totalPoints,
      base_points: pointsInfo.basePoints,
      milestone_bonus: pointsInfo.milestoneBonus,
      is_milestone: pointsInfo.isMilestone,
      new_streak: nextStreak,
      next_milestone: pointsInfo.nextMilestone,
      balance: newBalance,
      ticket_object_id: ticketId, // PC clients need this
      points_amount: pointsInfo.totalPoints,
      message: pointsInfo.isMilestone
        ? `Milestone! ${pointsInfo.totalPoints} points (${pointsInfo.basePoints} + ${pointsInfo.milestoneBonus} bonus) — day ${nextStreak}!`
        : `Earned ${pointsInfo.totalPoints} pt${pointsInfo.totalPoints !== 1 ? "s" : ""} — ${nextStreak}-day streak!`,
    });
  } catch (error) {
    console.error("Error in checkin process:", error);
    next(error);
  }
};

router.post("/request-ticket", handleCheckin);
router.post("/perform", handleCheckin); 

export default router;