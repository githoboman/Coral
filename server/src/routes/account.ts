import { Router, Request, Response, NextFunction } from "express";
import { WalrusUserManager, getWalrusUserManager } from "../services/walrusUserManager";
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

      const balance = await minter.getBalance(user_id);

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
      const minter = getLocalTicketMinter();

      const blobId = await minter.getCurrentBlobId();
      if (!blobId) {
        return res.json({ leaderboard: [] });
      }

      const um = getUserManager();
      const registry = await um.fetchUsersRegistry(blobId);
      if (!registry) {
        return res.json({ leaderboard: [] });
      }

      console.log(`[LEADERBOARD] Processing ${registry.total_users} users`);

      const usersWithPoints = await Promise.all(
        Object.keys(registry.users).map(async (wallet) => {
          try {
            const decryptedProfile = await um.getUserProfile(blobId, wallet);
            if (!decryptedProfile) {
              return null;
            }

            const balance = await minter.getBalance(wallet);

            return {
              user_id: wallet,
              wallet_address: wallet,
              username:
                decryptedProfile.username ||
                `User ${wallet.substring(0, 6)}...`,
              email: decryptedProfile.email,
              points: balance,
              referral_points: 0,
            };
          } catch (error) {
            console.error(`Error processing user ${wallet}:`, error);
            return null;
          }
        }),
      );

      const validUsers = usersWithPoints.filter(
        (u) => u !== null && u.points > 0,
      );

      const leaderboard = validUsers
        .sort((a, b) => b!.points - a!.points)
        .slice(0, 100)
        .map((user, idx) => ({
          rank: idx + 1,
          user_id: user!.user_id,
          wallet_address: user!.wallet_address,
          username: user!.username,
          points: user!.points,
          referral_points: user!.referral_points,
        }));

      console.log(`[LEADERBOARD] Returning ${leaderboard.length} users`);

      return res.json({ leaderboard });
    } catch (error) {
      console.error("Error fetching leaderboard:", error);
      next(error);
    }
  },
);

export default router;
