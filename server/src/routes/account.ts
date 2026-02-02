// src/routes/account.ts - UPDATED FOR WALRUS + SUI
import { Router, Request, Response, NextFunction } from "express";
import { WalrusUserManager } from "../services/walrusUserManager";
import { PointsManager } from "../services/pointsManager";

const router = Router();

const USER_REGISTRY_BLOB_ID = process.env.USER_REGISTRY_BLOB_ID || "";

let userManager: WalrusUserManager | null = null;
let pointsManager: PointsManager | null = null;

function getUserManager(): WalrusUserManager {
  if (!userManager) {
    userManager = new WalrusUserManager();
  }
  return userManager;
}

function getPointsManager(): PointsManager {
  if (!pointsManager) {
    pointsManager = new PointsManager();
  }
  return pointsManager;
}

/**
 * GET /api/account/:user_id
 * Get user account details with points from blockchain
 */
router.get(
  "/account/:user_id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { user_id } = req.params; // This is wallet_address

      if (!user_id.trim()) {
        return res.status(400).json({
          error: "Bad Request",
          detail: "User ID cannot be empty",
        });
      }

      if (!USER_REGISTRY_BLOB_ID) {
        return res.status(404).json({
          error: "Not Found",
          detail: "User registry not initialized",
        });
      }

      const managers = {
        user: getUserManager(),
        points: getPointsManager(),
      };

      // Get user profile from Walrus
      const userProfile = await managers.user.getUserProfile(
        USER_REGISTRY_BLOB_ID,
        user_id,
      );

      if (!userProfile) {
        return res.status(404).json({
          error: "Not Found",
          detail: "User not found",
        });
      }

      // Get points from Sui blockchain
      const points = await managers.points.getBalance(user_id);

      // Return account details
      return res.json({
        user_id: user_id,
        wallet_address: userProfile.wallet_address,
        email: userProfile.email,
        username: userProfile.username,
        first_name: userProfile.first_name,
        last_name: userProfile.last_name,
        points: points,
        referral_points: 0, // TODO: Implement referral system
        rank: null, // TODO: Implement ranking system
        is_premium: false, // TODO: Implement premium system
        created_at: userProfile.joined_at,
      });
    } catch (error) {
      console.error("Error fetching account:", error);
      next(error);
    }
  },
);

/**
 * GET /api/leaderboard
 * Get top users by points from blockchain
 * Note: This is a simplified version. For production, you'd want to:
 * 1. Cache leaderboard data
 * 2. Build it from blockchain events
 * 3. Or maintain a separate leaderboard registry
 */
router.get(
  "/leaderboard",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!USER_REGISTRY_BLOB_ID) {
        return res.json({ leaderboard: [] });
      }

      const managers = {
        user: getUserManager(),
        points: getPointsManager(),
      };

      // Get all users from registry
      const registry = await managers.user.fetchUsersRegistry(
        USER_REGISTRY_BLOB_ID,
      );

      if (!registry) {
        return res.json({ leaderboard: [] });
      }

      // Get points for each user
      const usersWithPoints = await Promise.all(
        Object.entries(registry.users).map(async ([wallet, profile]) => {
          const points = await managers.points.getBalance(wallet);
          return {
            user_id: wallet,
            wallet_address: wallet,
            username: profile.username,
            email: profile.email,
            points: points,
            referral_points: 0,
          };
        }),
      );

      // Sort by points
      const leaderboard = usersWithPoints
        .sort((a, b) => b.points - a.points)
        .slice(0, 100)
        .map((user, idx) => ({
          ...user,
          rank: idx + 1,
        }));

      // Cache for 5 minutes
      res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
      return res.json({ leaderboard });
    } catch (error) {
      console.error("Error fetching leaderboard:", error);
      next(error);
    }
  },
);

/**
 * POST /api/add-points/:user_id
 * Add points to user (admin only)
 */
router.post(
  "/add-points/:user_id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { user_id } = req.params;
      const { amount } = req.body;

      if (!user_id.trim()) {
        return res.status(400).json({
          error: "Bad Request",
          detail: "User ID cannot be empty",
        });
      }

      if (!amount || amount <= 0) {
        return res.status(400).json({
          error: "Bad Request",
          detail: "Amount must be a positive number",
        });
      }

      const pointsManager = getPointsManager();

      // Mint points on blockchain
      const txDigest = await pointsManager.mintPoints(
        user_id,
        amount,
        "Manual Point Addition",
      );

      // Get new balance
      const newBalance = await pointsManager.getBalance(user_id);

      return res.json({
        message: "Points added successfully",
        user_id,
        points_added: amount,
        total_points: newBalance,
        tx_digest: txDigest,
      });
    } catch (error) {
      console.error("Error adding points:", error);
      next(error);
    }
  },
);

export default router;
