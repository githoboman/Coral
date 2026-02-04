import { Router, Request, Response, NextFunction } from "express";
import { WalrusUserManager } from "../services/walrusUserManager";
import { TicketMinter } from "../services/ticketMinter";

const router = Router();

let userManager: WalrusUserManager | null = null;
let ticketMinter: TicketMinter | null = null;

function getUserManager(): WalrusUserManager {
  if (!userManager) userManager = new WalrusUserManager();
  return userManager;
}
function getTicketMinter(): TicketMinter {
  if (!ticketMinter) ticketMinter = new TicketMinter();
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

      const minter = getTicketMinter();

      const blobId = await minter.getCurrentBlobId();
      if (!blobId) {
        return res.status(404).json({
          error: "Not Found",
          detail: "User registry not initialized",
        });
      }

      const um = getUserManager();
      // getUserProfile now decrypts automatically
      const userProfile = await um.getUserProfile(blobId, user_id);

      if (!userProfile) {
        return res
          .status(404)
          .json({ error: "Not Found", detail: "User not found" });
      }

      const balance = await minter.getBalance(user_id);

      // userProfile is already decrypted
      return res.json({
        user_id,
        wallet_address: userProfile.wallet_address,
        email: userProfile.email, // Decrypted
        username: userProfile.username, // Decrypted
        first_name: userProfile.first_name, // Decrypted
        last_name: userProfile.last_name, // Decrypted
        points: balance,
        referral_points: 0,
        rank: null,
        is_premium: false,
        created_at: userProfile.joined_at,
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
      const minter = getTicketMinter();

      const blobId = await minter.getCurrentBlobId();
      if (!blobId) {
        return res.json({ leaderboard: [] });
      }

      const um = getUserManager();
      const registry = await um.fetchUsersRegistry(blobId);
      if (!registry) {
        return res.json({ leaderboard: [] });
      }

      // Decrypt each profile and get points
      const usersWithPoints = await Promise.all(
        Object.keys(registry.users).map(async (wallet) => {
          // Decrypt the profile
          const decryptedProfile = await um.getUserProfile(blobId, wallet);
          if (!decryptedProfile) {
            return null;
          }

          const balance = await minter.getBalance(wallet);
          return {
            user_id: wallet,
            wallet_address: wallet,
            username: decryptedProfile.username, // Decrypted
            email: decryptedProfile.email, // Decrypted
            points: balance,
            referral_points: 0,
          };
        }),
      );

      // Filter out nulls and sort
      const validUsers = usersWithPoints.filter((u) => u !== null);
      const leaderboard = validUsers
        .sort((a, b) => b!.points - a!.points)
        .slice(0, 100)
        .map((user, idx) => ({ ...user, rank: idx + 1 }));

      return res.json({ leaderboard });
    } catch (error) {
      console.error("Error fetching leaderboard:", error);
      next(error);
    }
  },
);

export default router;
