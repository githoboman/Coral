// src/routes/account.ts  —  UPDATED
//
// Changes from previous version:
//   • Uses TicketMinter (not PointsManager) for on-chain reads
//   • Reads the current Walrus blob ID from the on-chain BlobRegistry
//     instead of from process.env.USER_REGISTRY_BLOB_ID
//   • Removed POST /add-points  (no more admin minting — users claim via ticket)
//   • Leaderboard still works: iterates Walrus registry, reads each balance on-chain

import { Router, Request, Response, NextFunction } from "express";
import { WalrusUserManager } from "../services/walrusUserManager";
import { TicketMinter } from "../services/ticketMinter";

const router = Router();

// ---------------------------------------------------------------------------
// Singletons
// ---------------------------------------------------------------------------
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

// =======================================================================
// GET /api/account/:user_id   (user_id = wallet_address)
// =======================================================================
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

      // --- Read current blob ID from on-chain BlobRegistry (no .env needed) ---
      const blobId = await minter.getCurrentBlobId();
      if (!blobId) {
        return res.status(404).json({
          error: "Not Found",
          detail: "User registry not initialized",
        });
      }

      // --- Fetch profile from Walrus (email lives here) ---
      const um = getUserManager();
      const userProfile = await um.getUserProfile(blobId, user_id);

      if (!userProfile) {
        return res
          .status(404)
          .json({ error: "Not Found", detail: "User not found" });
      }

      // --- Read balance from on-chain PointsRegistry ---
      const balance = await minter.getBalance(user_id);

      return res.json({
        user_id,
        wallet_address: userProfile.wallet_address,
        email: userProfile.email,
        username: userProfile.username,
        first_name: userProfile.first_name,
        last_name: userProfile.last_name,
        points: balance,
        referral_points: 0, // TODO: referral system
        rank: null, // set by leaderboard
        is_premium: false, // TODO: premium system
        created_at: userProfile.joined_at,
      });
    } catch (error) {
      console.error("Error fetching account:", error);
      next(error);
    }
  },
);

// =======================================================================
// GET /api/leaderboard
//
// Reads all users from Walrus registry, fetches each balance on-chain,
// sorts, and returns top 100.
//
// Performance note: for large user bases this should be cached / built
// from on-chain events.  For now it's fine at <200 users.
// =======================================================================
router.get(
  "/leaderboard",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const minter = getTicketMinter();

      // --- Current blob from chain ---
      const blobId = await minter.getCurrentBlobId();
      if (!blobId) {
        return res.json({ leaderboard: [] });
      }

      // --- All users from Walrus ---
      const um = getUserManager();
      const registry = await um.fetchUsersRegistry(blobId);
      if (!registry) {
        return res.json({ leaderboard: [] });
      }

      // --- Fetch on-chain balances in parallel ---
      const usersWithPoints = await Promise.all(
        Object.entries(registry.users).map(async ([wallet, profile]) => {
          const balance = await minter.getBalance(wallet);
          return {
            user_id: wallet,
            wallet_address: wallet,
            username: profile.username,
            email: profile.email,
            points: balance,
            referral_points: 0,
          };
        }),
      );

      // --- Sort & slice ---
      const leaderboard = usersWithPoints
        .sort((a, b) => b.points - a.points)
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
