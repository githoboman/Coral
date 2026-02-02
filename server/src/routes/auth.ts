// src/routes/auth.ts
import { Router, Request, Response, NextFunction } from "express";
import { WaitlistManager } from "../services/waitlistManager";
import { WalrusUserManager } from "../services/walrusUserManager";
import { PointsManager } from "../services/pointsManager";

const router = Router();

// Blob IDs from environment
const WHITELIST_BLOB_ID = process.env.WHITELIST_BLOB_ID || "";
const USER_REGISTRY_BLOB_ID = process.env.USER_REGISTRY_BLOB_ID || "";

// Service managers (singleton pattern)
let waitlistManager: WaitlistManager | null = null;
let userManager: WalrusUserManager | null = null;
let pointsManager: PointsManager | null = null;

function getWaitlistManager(): WaitlistManager {
  if (!waitlistManager) {
    waitlistManager = new WaitlistManager();
  }
  return waitlistManager;
}

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
 * POST /api/auth/verify-and-register
 * Verify email against waitlist and register user
 * Awards 300 points if waitlisted, 0 if not
 */
router.post(
  "/verify-and-register",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const {
        email,
        wallet_address,
        username,
        first_name,
        last_name,
        preferences,
      } = req.body;

      // Validation
      if (!email || typeof email !== "string") {
        res.status(400).json({
          error: "Bad Request",
          detail: "Email is required",
        });
        return;
      }

      if (!wallet_address || typeof wallet_address !== "string") {
        res.status(400).json({
          error: "Bad Request",
          detail: "Wallet address is required",
        });
        return;
      }

      if (!WHITELIST_BLOB_ID) {
        res.status(500).json({
          error: "Configuration Error",
          detail: "Waitlist not configured",
        });
        return;
      }

      const normalizedEmail = email.toLowerCase().trim();
      const managers = {
        waitlist: getWaitlistManager(),
        user: getUserManager(),
        points: getPointsManager(),
      };

      // Step 1: Check if email is waitlisted
      console.log(`\n🔍 Checking waitlist status for: ${normalizedEmail}`);
      const isWaitlisted = await managers.waitlist.isEmailWhitelisted(
        normalizedEmail,
        WHITELIST_BLOB_ID,
      );

      // Step 2: Determine points to award
      const pointsToAward = isWaitlisted ? 300 : 0;
      console.log(`   Waitlisted: ${isWaitlisted}`);
      console.log(`   Points to award: ${pointsToAward}`);

      // Step 3: Create user profile
      const userProfile = managers.user.createUserProfile(
        normalizedEmail,
        wallet_address,
        isWaitlisted,
        pointsToAward,
        {
          username,
          first_name,
          last_name,
          preferences,
        },
      );

      // Step 4: Save user profile to Walrus
      console.log(`\n💾 Saving user profile to Walrus...`);
      const newRegistryBlobId = await managers.user.addOrUpdateUser(
        USER_REGISTRY_BLOB_ID || null,
        userProfile,
      );

      if (!newRegistryBlobId) {
        res.status(500).json({
          error: "Internal Server Error",
          detail: "Failed to save user profile",
        });
        return;
      }

      // Step 5: Mint points on-chain (if any)
      let txDigest: string | null = null;
      if (pointsToAward > 0) {
        try {
          console.log(`\n🪙 Minting ${pointsToAward} points on-chain...`);
          txDigest = await managers.points.mintPoints(
            wallet_address,
            pointsToAward,
            isWaitlisted ? "Waitlist Bonus" : "Welcome Bonus",
          );
        } catch (error) {
          console.error(
            "⚠️  Points minting failed (continuing anyway):",
            error,
          );
          // Don't fail the registration if points fail
        }
      }

      // Step 6: Log new registry blob ID (admin needs to update .env)
      if (newRegistryBlobId !== USER_REGISTRY_BLOB_ID) {
        console.log("\n⚠️  USER REGISTRY UPDATED!");
        console.log(`   Update your .env file:`);
        console.log(`   USER_REGISTRY_BLOB_ID=${newRegistryBlobId}`);
      }

      // Success response
      res.json({
        success: true,
        message: "Registration successful!",
        user: {
          email: normalizedEmail,
          wallet_address,
          is_waitlisted: isWaitlisted,
          points_awarded: pointsToAward,
        },
        registry_blob_id: newRegistryBlobId,
        tx_digest: txDigest,
      });
    } catch (error) {
      console.error("Error in verify-and-register:", error);
      next(error);
    }
  },
);

/**
 * GET /api/auth/check-user
 * Check if user exists and get their profile
 */
router.get(
  "/check-user",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { wallet_address } = req.query;

      if (!wallet_address || typeof wallet_address !== "string") {
        res.status(400).json({
          error: "Bad Request",
          detail: "Wallet address is required",
        });
        return;
      }

      if (!USER_REGISTRY_BLOB_ID) {
        res.json({
          exists: false,
          user: null,
        });
        return;
      }

      const userManager = getUserManager();
      const userProfile = await userManager.getUserProfile(
        USER_REGISTRY_BLOB_ID,
        wallet_address,
      );

      if (userProfile) {
        res.json({
          exists: true,
          user: userProfile,
        });
      } else {
        res.json({
          exists: false,
          user: null,
        });
      }
    } catch (error) {
      console.error("Error in check-user:", error);
      next(error);
    }
  },
);

export default router;
