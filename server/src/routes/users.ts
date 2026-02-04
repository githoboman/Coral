import { Router, Request, Response, NextFunction } from "express";
import { WalrusUserManager } from "../services/walrusUserManager";

const router = Router();

const USER_REGISTRY_BLOB_ID = process.env.USER_REGISTRY_BLOB_ID || "";

let userManager: WalrusUserManager | null = null;

function getUserManager(): WalrusUserManager {
  if (!userManager) {
    userManager = new WalrusUserManager();
  }
  return userManager;
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

      if (!USER_REGISTRY_BLOB_ID) {
        return res.json({
          exists: false,
          user: null,
          is_onboarded: false,
        });
      }

      const manager = getUserManager();
      // getUserProfile returns DecryptedUserProfile | null
      const userProfile = await manager.getUserProfile(
        USER_REGISTRY_BLOB_ID,
        user_id,
      );

      if (userProfile) {
        const isOnboarded = !!userProfile.email;
        return res.json({
          exists: true,
          user: userProfile, // Already decrypted
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

      // getUserProfile returns DecryptedUserProfile | null
      const existingProfile = await manager.getUserProfile(
        USER_REGISTRY_BLOB_ID,
        user_id,
      );

      // Create new profile (this returns UserProfile with encrypted fields)
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

      // addOrUpdateUser expects UserProfile (encrypted)
      const newBlobId = await manager.addOrUpdateUser(
        USER_REGISTRY_BLOB_ID || null,
        updatedProfile, // This is UserProfile, not DecryptedUserProfile
      );

      if (!newBlobId) {
        return res.status(500).json({
          error: "Internal Server Error",
          detail: "Failed to update user profile",
        });
      }

      if (newBlobId !== USER_REGISTRY_BLOB_ID) {
        console.log(`\n⚠️  Update .env: USER_REGISTRY_BLOB_ID=${newBlobId}`);
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

export default router;
