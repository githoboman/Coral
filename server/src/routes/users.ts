import { Router, Request, Response, NextFunction } from "express";
import { TicketMinter, getTicketMinter } from "../services/ticketMinter";
import { UserManager, getUserManager } from "../services/userManager";
import { requireAuth } from "../middleware/auth";


const router = Router();

let userManager: UserManager | null = null;
let ticketMinter: TicketMinter | null = null;

function getLocalUserManager(): UserManager {
  if (!userManager) {
    userManager = getUserManager();
  }
  return userManager;
}

function getLocalTicketMinter(): TicketMinter {
  if (!ticketMinter) {
    ticketMinter = getTicketMinter();
  }
  return ticketMinter;
}

router.get(
  "/fetch-user",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { user_id } = req.query;

      if (!user_id || typeof user_id !== "string" || !user_id.trim()) {
        return res.status(400).json({
          error: "Bad Request",
          detail: "User ID cannot be empty",
        });
      }

      const manager = getLocalUserManager();
      const userProfile = await manager.getUserProfile(user_id);

      if (userProfile) {
        const isOnboarded = !!userProfile.email;
        return res.json({
          exists: true,
          user: userProfile,
          is_onboarded: isOnboarded,
        });
      }

      return res.json({
        exists: false,
        user: null,
        is_onboarded: false,
      });
    } catch (error) {
      console.error("Error in fetch-user:", error);
      next(error);
    }
  },
);

router.post(
  "/update-user",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        user_id,
        wallet_address,
        email,
        username,
        first_name,
        last_name,
        preferences,
      } = req.body;

      if (!user_id || !user_id.trim()) {
        return res.status(400).json({
          error: "Bad Request",
          detail: "User ID cannot be empty",
        });
      }

      const manager = getLocalUserManager();

      // Fetch existing from Supabase
      const existingProfile = await manager.getUserProfile(user_id);

      const updatedProfile = manager.createUserProfile(
        email || existingProfile?.email || "",
        wallet_address || user_id,
        existingProfile?.is_waitlisted || false,
        existingProfile?.points_awarded || 0,
        {
          username: username || existingProfile?.username,
          first_name: first_name || existingProfile?.first_name,
          last_name: last_name || existingProfile?.last_name,
          preferences: preferences || existingProfile?.preferences,
          waitlist_verified_at: existingProfile?.waitlist_verified_at,
        },
      );

      const result = await manager.addOrUpdateUser(updatedProfile);

      if (!result) {
        return res.status(500).json({
          error: "Internal Server Error",
          detail: "Failed to update user profile in database",
        });
      }

      return res.json({
        message: "User profile updated successfully",
        user_id,
        requires_onboarding: !(email || existingProfile?.email),
      });
    } catch (error) {
      console.error("Error in update-user:", error);
      next(error);
    }
  },
);

router.post(
  "/user/alert-wallet",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { wallet_address: alert_wallet } = req.body;
      const user = (req as any).user;
      const currentUserWallet = user?.wallet_address || user?.id;

      if (!alert_wallet || typeof alert_wallet !== "string") {
        return res.status(400).json({ error: "wallet_address is required" });
      }

      if (!currentUserWallet) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const manager = getLocalUserManager();
      const updatedArray = await manager.addAlertWallet(currentUserWallet, alert_wallet);

      if (!updatedArray) {
        return res.status(500).json({ error: "Failed to add alert wallet" });
      }

      return res.json({ alert_wallets: updatedArray });
    } catch (error) {
      console.error("Error in add-alert-wallet:", error);
      next(error);
    }
  }
);

router.delete(
  "/user/alert-wallet",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { wallet_address: alert_wallet } = req.body;
      const user = (req as any).user;
      const currentUserWallet = user?.wallet_address || user?.id;

      if (!alert_wallet || typeof alert_wallet !== "string") {
        return res.status(400).json({ error: "wallet_address is required" });
      }

      if (!currentUserWallet) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const manager = getLocalUserManager();
      const updatedArray = await manager.removeAlertWallet(currentUserWallet, alert_wallet);

      if (!updatedArray) {
        return res.status(500).json({ error: "Failed to remove alert wallet" });
      }

      return res.json({ alert_wallets: updatedArray });
    } catch (error) {
      console.error("Error in remove-alert-wallet:", error);
      next(error);
    }
  }
);

router.post(
  "/user/recently-analyzed",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { wallet_address } = req.body;
      const user = (req as any).user;

      if (!wallet_address || typeof wallet_address !== "string") {
        return res.status(400).json({ error: "wallet_address is required" });
      }

      const manager = getLocalUserManager();
      
      // We assume user is attached via requireAuth and has wallet_address property
      // If it's a token payload, it might be in user.wallet_address or user.id
      const currentUserWallet = user?.wallet_address || user?.id;
      
      if (!currentUserWallet) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const updatedArray = await manager.addRecentlyAnalyzed(currentUserWallet, wallet_address);

      if (!updatedArray) {
        return res.status(500).json({ error: "Failed to update recently analyzed list" });
      }

      return res.json({ recently_analyzed: updatedArray });
    } catch (error) {
      console.error("Error in recently-analyzed:", error);
      next(error);
    }
  }
);

export default router;