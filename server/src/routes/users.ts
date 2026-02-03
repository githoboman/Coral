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

<<<<<<< HEAD


/**
 * POST /api/onboard-user
 * Onboard user with email (validates against waitlist)
 */
router.post('/onboard-user', validate(userOnboardSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      user_id,
      email,
      username,
      first_name,
      last_name,
      notifications_enabled,
      analytics_enabled,
      personalization_enabled
    } = req.body as UserOnboardRequest;

    if (!user_id.trim()) {
      return res.status(400).json({
        error: 'Bad Request',
        detail: 'User ID cannot be empty',
      });
    }

    if (!email.trim()) {
      return res.status(400).json({
        error: 'Bad Request',
        detail: 'Email cannot be empty',
      });
    }

    const supabase = getSupabaseClient();


    // Check if email is already in use by another user
    const { data: existingUser, error: existingError } = await supabase
      .from('user_profiles')
      .select('user_id')
      .eq('email', email)
      .single();

    if (existingError && existingError.code !== 'PGRST116') {
      console.error('Error checking existing user:', existingError);
      throw existingError;
    }

    if (existingUser && existingUser.user_id !== user_id) {
      console.warn(`Email already in use: ${email}`);
      return res.status(409).json({
        error: 'Conflict',
        detail: 'An account with this email already exists.',
      });
    }

    // Update user profile
    const updateData: Partial<UserProfile> = {
      user_id,
      email,
      last_active: new Date().toISOString(),
      preferences: {
        notifications_enabled,
        analytics_enabled,
        personalization_enabled
=======
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
>>>>>>> f0d8db8fed36c78e646947c6fdcb93f317ca1773
      }

      if (!USER_REGISTRY_BLOB_ID) {
        return res.json({
          exists: false,
          user: null,
          is_onboarded: false,
        });
      }

      const manager = getUserManager();
      const userProfile = await manager.getUserProfile(
        USER_REGISTRY_BLOB_ID,
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

      if (!user_id.trim()) {
        return res.status(400).json({
          error: "Bad Request",
          detail: "User ID cannot be empty",
        });
      }

      const manager = getUserManager();

      let userProfile = await manager.getUserProfile(
        USER_REGISTRY_BLOB_ID,
        user_id,
      );

      if (userProfile) {
        userProfile = {
          ...userProfile,
          email: email || userProfile.email,
          username: username || userProfile.username,
          first_name: first_name || userProfile.first_name,
          last_name: last_name || userProfile.last_name,
          preferences: preferences || userProfile.preferences,
        };
      } else {
        userProfile = manager.createUserProfile(
          email || "",
          wallet_address || user_id,
          false,
          0,
          {
            username,
            first_name,
            last_name,
            preferences,
          },
        );
      }

      const newBlobId = await manager.addOrUpdateUser(
        USER_REGISTRY_BLOB_ID || null,
        userProfile,
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
        requires_onboarding: !userProfile.email,
        registry_blob_id: newBlobId,
      });
    } catch (error) {
      console.error("Error in update-user:", error);
      next(error);
    }
  },
);

export default router;
