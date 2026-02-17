import { Router, Request, Response, NextFunction } from "express";
import {
  WalrusUserManager,
  getWalrusUserManager,
} from "../services/walrusUserManager";
import { TicketMinter, getTicketMinter } from "../services/ticketMinter";
import { getLeaderboardService } from "../services/leaderboardService";

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

const leaderboardService = getLeaderboardService();

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
      // Background update is handled by the service automatically
      const entries = await leaderboardService.getLeaderboard();
      return res.json({ leaderboard: entries });
    } catch (error) {
      console.error("[LEADERBOARD] Error:", error);
      next(error);
    }
  },
);

export default router;

