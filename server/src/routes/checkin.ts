import { Router, Request, Response, NextFunction } from "express";
import { TicketMinter, getTicketMinter } from "../services/ticketMinter";
import { getLeaderboardService } from "../services/leaderboardService";
import { getUserManager } from "../services/userManager";
import getSupabaseClient from "../config/supabase";
import { requireAuth } from "../middleware/auth";


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

function sanitizeOffset(raw: unknown): number {
  const n = parseInt(raw as string) || 0;
  return Math.max(-720, Math.min(840, n));
}

function localDateString(date: Date, tzOffset: number): string {
  const localMs = date.getTime() + tzOffset * 60_000;
  const d = new Date(localMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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

function nextLocalMidnightMs(tzOffset: number): number {
  const localMs = Date.now() + tzOffset * 60_000;
  const d = new Date(localMs);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 1); 
  return d.getTime() - tzOffset * 60_000; 
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

// ─── New Architecture Streak Logic ─────────────────────────────

interface StreakResult {
  nextStreak: number;
  streakWillReset: boolean;
}

interface DBCheckin {
  checkin_date: string;
  timezone_offset: number;
  streak_day: number;
}

/**
 * Derives the next streak value strictly from the checkins history row.
 */
function computeNextStreak(
  lastCheckin: DBCheckin | null,
  currentTzOffset: number,
): StreakResult {
  if (!lastCheckin) {
    return { nextStreak: 1, streakWillReset: false };
  }

  const { checkin_date: lastCheckinDate, timezone_offset: lastTzOffset, streak_day: currentStreak } = lastCheckin;

  const today = localDateString(new Date(), currentTzOffset);
  const yesterday = localYesterdayString(lastTzOffset);

  if (lastCheckinDate === yesterday) {
    return { nextStreak: currentStreak + 1, streakWillReset: false };
  }

  if (lastCheckinDate === today) {
    return { nextStreak: currentStreak, streakWillReset: false };
  }

  // Missed a day
  return { nextStreak: 1, streakWillReset: currentStreak > 0 };
}

// ─── Helpers ─────────────────────────────────────────────────────────

async function getLatestCheckinRow(userId: string): Promise<DBCheckin | null> {
  const { data, error } = await supabase
    .from("checkins")
    .select("checkin_date, timezone_offset, streak_day")
    .eq("user_id", userId.toLowerCase())
    .order("checkin_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[CHECKIN] Failed to fetch last check-in:", error);
    return null;
  }
  return data;
}

async function hasCheckinForDate(userId: string, dateStr: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("checkins")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId.toLowerCase())
    .eq("checkin_date", dateStr);

  return !error && (count || 0) > 0;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get(
  "/status",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { wallet_address, timezone_offset } = req.query;

      if (!wallet_address || typeof wallet_address !== "string") {
        res.status(400).json({ error: "wallet_address required" });
        return;
      }

      const userId = wallet_address.toLowerCase();
      const tzOffset = sanitizeOffset(timezone_offset);
      
      const lastCheckin = await getLatestCheckinRow(userId);
      const { nextStreak, streakWillReset } = computeNextStreak(lastCheckin, tzOffset);
      
      const guardTzOffset = lastCheckin?.timezone_offset ?? tzOffset;
      const todayDate = localDateString(new Date(), guardTzOffset);

      const [checkinFee, balance, alreadyCheckedInToday] = await Promise.all([
        getCachedCheckinFee(getLocalTicketMinter()),
        Promise.resolve(getLeaderboardService().getUserBalance(userId)),
        hasCheckinForDate(userId, todayDate),
      ]);

      const isPastDate = lastCheckin ? (todayDate < lastCheckin.checkin_date) : false;
      const canCheckin = !alreadyCheckedInToday && !isPastDate;

      const nextAvailableMs = canCheckin ? null : nextLocalMidnightMs(tzOffset);
      const pointsInfo = calculateCheckinPoints(nextStreak);

      res.json({
        can_checkin: canCheckin,
        last_checkin_date: lastCheckin?.checkin_date ?? null,
        next_available_at: nextAvailableMs,
        already_checked_in: alreadyCheckedInToday,
        balance,
        current_streak: lastCheckin?.streak_day ?? 0,
        next_streak: nextStreak,
        streak_will_reset: streakWillReset,
        next_checkin_points: pointsInfo.totalPoints,
        next_is_milestone: pointsInfo.isMilestone,
        next_milestone: pointsInfo.nextMilestone,
        checkin_fee: checkinFee,
      });
    } catch (error) {
      console.error("Error in checkin/status:", error);
      next(error);
    }
  },
);

const handleCheckin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { wallet_address, timezone_offset } = req.body;

    if (!wallet_address || typeof wallet_address !== "string") {
      res.status(400).json({ error: "wallet_address required" });
      return;
    }

    const userId = wallet_address.toLowerCase();
    const tzOffset = sanitizeOffset(timezone_offset);
    
    // 1. Fetch source of truth from history table
    const lastCheckin = await getLatestCheckinRow(userId);
    
    // 2. Computed "Today" using the guard offset (stored or current)
    const guardTzOffset = lastCheckin?.timezone_offset ?? tzOffset;
    const todayDate = localDateString(new Date(), guardTzOffset);

    // 3. Duplicate Guard
    const alreadyCheckedIn = await hasCheckinForDate(userId, todayDate);
    if (alreadyCheckedIn || (lastCheckin && lastCheckin.checkin_date === todayDate)) {
      res.status(400).json({ 
        success: false, 
        message: "Already checked in today.",
        next_available_at: nextLocalMidnightMs(tzOffset)
      });
      return;
    }

    // 4. Time Travel Guard
    if (lastCheckin && todayDate < lastCheckin.checkin_date) {
      res.status(400).json({ 
        success: false, 
        message: `Invalid date. You have a record for ${lastCheckin.checkin_date}.` 
      });
      return;
    }

    // 5. Calculate results
    const { nextStreak } = computeNextStreak(lastCheckin, tzOffset);
    const pointsInfo = calculateCheckinPoints(nextStreak);

    console.log(`[CHECKIN] User ${userId.slice(0, 8)}: ${nextStreak-1} -> ${nextStreak} streak.`);

    // 6. Award points instantly (service manages memory/ledger)
    await getLeaderboardService().creditPoints(userId, pointsInfo.totalPoints);
    const newBalance = await getLeaderboardService().getUserBalance(userId);

    // 7. Atomic DB Operation via RPC
    const { error: rpcError } = await supabase.rpc("record_checkin", {
      p_user_id: userId,
      p_checkin_date: todayDate,
      p_timezone_offset: tzOffset,
      p_streak_day: nextStreak,
      p_points_earned: pointsInfo.totalPoints,
      p_new_balance: newBalance,
    });

    if (rpcError) {
      console.error("[CHECKIN] RPC Transaction failed:", rpcError);
      res.status(500).json({ success: false, message: "Database transaction failed." });
      return;
    }

    // 8. Optional bridge/ticket minting (non-blocking)
    let ticketId: string | null = null;
    try {
      ticketId = await getLocalTicketMinter().mintCheckinTicket(userId, pointsInfo.totalPoints, todayDate);
    } catch (e) {
      console.warn("[CHECKIN] Ticket mint failed:", e);
    }

    // 9. Sync user stats in background
    try {
      await getUserManager().updateCheckinStats(userId, pointsInfo.totalPoints, nextStreak, todayDate);
    } catch (e) {}

    res.json({
      success: true,
      checkin_date: todayDate,
      points_earned: pointsInfo.totalPoints,
      new_streak: nextStreak,
      balance: newBalance,
      ticket_object_id: ticketId,
      message: pointsInfo.isMilestone
        ? `Milestone! Day ${nextStreak}!`
        : `Checked in! ${nextStreak}-day streak.`,
    });
  } catch (error) {
    console.error("Error in checkin process:", error);
    next(error);
  }
};

router.post("/request-ticket", requireAuth, handleCheckin);
router.post("/perform", requireAuth, handleCheckin); 

export default router;