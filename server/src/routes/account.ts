import { Router, Request, Response, NextFunction } from "express";
import {
  UserManager,
  getUserManager,
} from "../services/userManager";
import { getLeaderboardService } from "../services/leaderboardService";
import { requireAuth } from "../middleware/auth";
import { normalizeAddr } from "./auth";


const router = Router();

let userManager: UserManager | null = null;

function getLocalUserManager(): UserManager {
  if (!userManager) userManager = getUserManager();
  return userManager;
}

const leaderboardService = getLeaderboardService();

router.get(
  "/account/:user_id",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { user_id } = req.params;

      if (!user_id?.trim()) {
        return res
          .status(400)
          .json({ error: "Bad Request", detail: "User ID cannot be empty" });
      }
      
      const normalizedAddr = normalizeAddr(user_id);
      
      if (normalizedAddr.length !== 66) {
        return res.status(400).json({
          error: "Bad Request",
          detail: "Invalid wallet address format. Expected 64-character hex with 0x prefix.",
        });
      }

      const um = getLocalUserManager();
      const userProfile = await um.getUserProfile(normalizedAddr);

      if (!userProfile) {
        return res
          .status(404)
          .json({ error: "Not Found", detail: "User not found" });
      }

      // Use the optimized service for balance
      const balance = leaderboardService.getUserBalance(user_id);

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
      const { wallet_address } = req.query;
      const entries = await leaderboardService.getLeaderboard();

      // If wallet_address provided, include user's rank (even if outside top 100)
      let user_rank = null;
      let total_participants = 0;
      
      if (wallet_address && typeof wallet_address === "string") {
        const normalizedWallet = normalizeAddr(wallet_address);
        user_rank = await leaderboardService.getUserRank(normalizedWallet);
        total_participants = user_rank.total_participants;
      } else {
        total_participants = await leaderboardService.getTotalParticipants();
      }

      return res.json({ leaderboard: entries, user_rank, total_participants });
    } catch (error) {
      console.error("[LEADERBOARD] Error:", error);
      next(error);
    }
  },
);

export default router;

