import { Router, Request, Response, NextFunction } from "express";
import { TicketMinter } from "../services/ticketMinter";
import { WalrusUserManager } from "../services/walrusUserManager";

const router = Router();

let ticketMinter: TicketMinter | null = null;
let userManager: WalrusUserManager | null = null;

function getTicketMinter(): TicketMinter {
  if (!ticketMinter) ticketMinter = new TicketMinter();
  return ticketMinter;
}

function getUserManager(): WalrusUserManager {
  if (!userManager) userManager = new WalrusUserManager();
  return userManager;
}

// ============================================================================
// DATE UTILITY FUNCTIONS
// ============================================================================

/**
 * Get user's current date in their timezone
 * @param timezoneOffset - Offset in minutes (e.g., -300 for EST)
 * @returns Date string in YYYY-MM-DD format
 */
function getUserDate(timezoneOffset: number): string {
  const now = new Date();
  // Apply timezone offset
  const userMs = now.getTime() + timezoneOffset * 60000;
  const userDate = new Date(userMs);

  // Extract YYYY-MM-DD
  const year = userDate.getUTCFullYear();
  const month = String(userDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(userDate.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/**
 * Get yesterday's date in user's timezone
 */
function getYesterdayDate(timezoneOffset: number): string {
  const now = new Date();
  const userMs = now.getTime() + timezoneOffset * 60000;
  const userDate = new Date(userMs);

  // Subtract one day
  userDate.setUTCDate(userDate.getUTCDate() - 1);

  const year = userDate.getUTCFullYear();
  const month = String(userDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(userDate.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/**
 * Get midnight timestamp in user's timezone
 * This is when the next check-in becomes available
 */
function getMidnightTimestamp(timezoneOffset: number): number {
  const now = new Date();
  const userMs = now.getTime() + timezoneOffset * 60000;
  const userDate = new Date(userMs);

  // Set to start of next day in UTC context
  userDate.setUTCHours(0, 0, 0, 0);
  userDate.setUTCDate(userDate.getUTCDate() + 1);

  // Convert back to actual UTC timestamp
  return userDate.getTime() - timezoneOffset * 60000;
}

/**
 * Check if two dates are consecutive calendar days
 */
function areDatesConsecutive(date1: string, date2: string): boolean {
  const d1 = new Date(date1 + "T00:00:00Z");
  const d2 = new Date(date2 + "T00:00:00Z");

  const diffMs = d2.getTime() - d1.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  return diffDays === 1;
}

// ============================================================================
// POINTS CALCULATION
// ============================================================================

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

// ============================================================================
// ROUTES
// ============================================================================

/**
 * GET /api/checkin/status
 * Check if user can check in and get streak info
 */
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

      const timezoneOffset = timezone_offset
        ? parseInt(timezone_offset as string)
        : 0;
      const minter = getTicketMinter();

      // Get user's current data
      const lastCheckinDate = await minter.getLastCheckinDate(wallet_address);
      const currentStreak = await minter.getCurrentStreak(wallet_address);
      const totalCheckins = await minter.getTotalCheckins(wallet_address);
      const balance = await minter.getBalance(wallet_address);

      // Calculate dates in user's timezone
      const userDateToday = getUserDate(timezoneOffset);
      const yesterdayDate = getYesterdayDate(timezoneOffset);

      // Determine if user can check in
      // Rule: Can check in if last_checkin_date !== today's date
      const canCheckin = lastCheckinDate !== userDateToday;

      let nextAvailableMs: number | null = null;
      let hoursRemaining: number | null = null;
      let streakWillReset = false;
      let nextStreak = 1;

      if (!canCheckin) {
        // Already checked in today - next available at midnight
        const midnightMs = getMidnightTimestamp(timezoneOffset);
        const now = Date.now();
        const timeRemainingMs = midnightMs - now;
        hoursRemaining = Math.ceil(timeRemainingMs / (1000 * 60 * 60));
        nextAvailableMs = midnightMs;
        nextStreak = currentStreak + 1; // Will continue if they check in tomorrow
      } else {
        // Can check in now
        if (lastCheckinDate) {
          // Check if streak will continue or reset
          if (lastCheckinDate === yesterdayDate) {
            // Last check-in was yesterday - streak continues
            nextStreak = currentStreak + 1;
            streakWillReset = false;
          } else {
            // Last check-in was NOT yesterday - streak will reset
            nextStreak = 1;
            streakWillReset = currentStreak > 0; // Only show warning if they had a streak
          }
        } else {
          // First time checking in
          nextStreak = 1;
          streakWillReset = false;
        }
      }

      // Calculate points for next check-in
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
      });
    } catch (error) {
      console.error("Error in checkin/status:", error);
      next(error);
    }
  },
);

/**
 * POST /api/checkin/request-ticket
 * Request a check-in ticket for today
 */
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

      const timezoneOffset = timezone_offset || 0;
      const minter = getTicketMinter();

      // Get user's current data
      const lastCheckinDate = await minter.getLastCheckinDate(wallet_address);
      const currentStreak = await minter.getCurrentStreak(wallet_address);

      // Calculate dates
      const userDateToday = getUserDate(timezoneOffset);
      const yesterdayDate = getYesterdayDate(timezoneOffset);

      // Check if already checked in today
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

      // Calculate next streak
      let nextStreak = 1;
      if (lastCheckinDate) {
        if (lastCheckinDate === yesterdayDate) {
          // Consecutive day - streak continues
          nextStreak = currentStreak + 1;
        } else {
          // Streak broken - reset to 1
          nextStreak = 1;
        }
      }

      const pointsInfo = calculateCheckinPoints(nextStreak);

      console.log(`🎟️  Minting check-in ticket for ${wallet_address}...`);
      console.log(`   Date: ${userDateToday}`);
      console.log(`   Current streak: ${currentStreak} → Next: ${nextStreak}`);
      console.log(
        `   Points: ${pointsInfo.totalPoints} (base: ${pointsInfo.basePoints}, bonus: ${pointsInfo.milestoneBonus})`,
      );
      console.log(`   Is milestone: ${pointsInfo.isMilestone}`);

      // Mint check-in ticket with date
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

      // Update Walrus with streak info (async, non-blocking)
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
        message: pointsInfo.isMilestone
          ? `🎉 Milestone! Check in to claim ${pointsInfo.totalPoints} points (${pointsInfo.basePoints} + ${pointsInfo.milestoneBonus} bonus) and reach day ${nextStreak}!`
          : `Check in to claim ${pointsInfo.totalPoints} point${pointsInfo.totalPoints !== 1 ? "s" : ""} and continue your ${nextStreak}-day streak!`,
      });
    } catch (error) {
      console.error("Error in checkin/request-ticket:", error);
      next(error);
    }
  },
);

export default router;
