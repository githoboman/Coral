import { Router, Request, Response, NextFunction } from "express";
import { TicketMinter, getTicketMinter } from "../services/ticketMinter";
import { WalrusUserManager, getWalrusUserManager } from "../services/walrusUserManager";

const router = Router();

let userManager: WalrusUserManager | null = null;
let ticketMinter: TicketMinter | null = null;

function getUserManager(): WalrusUserManager {
  if (!userManager) {
    userManager = getWalrusUserManager();
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

      const minter = getLocalTicketMinter();
      const userRegistryBlobId = await minter.getCurrentBlobId();

      if (!userRegistryBlobId) {
        return res.json({
          exists: false,
          user: null,
          is_onboarded: false,
        });
      }

      const manager = getUserManager();
      // getUserProfile returns DecryptedUserProfile | null
      const userProfile = await manager.getUserProfile(
        userRegistryBlobId,
        user_id,
      );

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

      const manager = getUserManager();
      const minter = getLocalTicketMinter();

      const userRegistryBlobId = await minter.getCurrentBlobId();
      // If no registry exists yet on-chain, we'll start a new one (passed as null to addOrUpdateUser)

      const existingProfile = userRegistryBlobId ? await manager.getUserProfile(
        userRegistryBlobId,
        user_id,
      ) : null;

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

      const newBlobId = await manager.addOrUpdateUser(
        userRegistryBlobId || null,
        updatedProfile,
      );

      if (!newBlobId) {
        return res.status(500).json({
          error: "Internal Server Error",
          detail: "Failed to update user profile",
        });
      }

      if (newBlobId !== userRegistryBlobId) {
        await minter.updateBlobRegistry(newBlobId);
      }

      return res.json({
        message: "User profile updated successfully",
        user_id,
        requires_onboarding: !(email || existingProfile?.email),
        registry_blob_id: newBlobId,
      });
    } catch (error) {
      console.error("Error in update-user:", error);
      next(error);
    }
  },
);

router.get(
  "/stats",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const minter = getLocalTicketMinter();
      const userRegistryBlobId = await minter.getCurrentBlobId();

      if (!userRegistryBlobId) {
        return res.json({
          totalUsers: 0,
        });
      }

      const manager = getUserManager();
      const registry = await manager.fetchUsersRegistry(userRegistryBlobId);

      let activeSubscribers = 0;
      let freeUsers = 0;

      if (registry && registry.users) {
        Object.values(registry.users).forEach((u) => {
          if (u.subscription_tier === 1) {
            activeSubscribers++;
          } else {
            freeUsers++;
          }
        });
      }

      return res.json({
        totalUsers: registry?.total_users || 0,
        activeSubscribers,
        freeUsers,
        blobId: userRegistryBlobId
      });

    } catch (error) {
      console.error("Error in /stats:", error);
      next(error);
    }
  }
);

export default router;
