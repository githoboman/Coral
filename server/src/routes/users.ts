import { Router, Request, Response, NextFunction } from "express";
import { TicketMinter, getTicketMinter } from "../services/ticketMinter";
import { UserManager, getUserManager } from "../services/userManager";

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

export default router;