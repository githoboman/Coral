// src/routes/users.ts
import { Router, Request, Response, NextFunction } from 'express';
import { getSupabaseClient } from '../config/supabase';
import { validate, userUpdateSchema, userOnboardSchema } from '../utils/validation';
import { UserProfile, UserUpdateRequest, UserOnboardRequest } from '../types';

const router = Router();

/**
 * GET /api/fetch-user
 * Fetch user profile by user_id
 */
router.get('/fetch-user', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id } = req.query;

    if (!user_id || typeof user_id !== 'string' || !user_id.trim()) {
      return res.status(400).json({
        error: 'Bad Request',
        detail: 'User ID cannot be empty',
      });
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', user_id)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching user:', error);
      throw error;
    }

    if (data) {
      console.log(`User found: ${user_id}`);
      const isOnboarded = !!data.email;
      return res.json({
        exists: true,
        user: data,
        is_onboarded: isOnboarded,
      });
    }

    console.log(`User not found: ${user_id}`);
    return res.json({
      exists: false,
      user: null,
      is_onboarded: false,
    });
  } catch (error) {
    console.error('Error in fetch-user:', error);
    next(error);
  }
});



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
      }
    };

    if (username) updateData.username = username;
    if (first_name) updateData.first_name = first_name;
    if (last_name) updateData.last_name = last_name;

    const { data: updatedUser, error: updateError } = await supabase
      .from('user_profiles')
      .update(updateData)
      .eq('user_id', user_id)
      .select()
      .single();

    if (updateError) {
      console.error(`Failed to onboard user: ${user_id}`, updateError);
      return res.status(500).json({
        error: 'Internal Server Error',
        detail: 'Failed to complete onboarding',
      });
    }

    console.log(`User onboarded successfully: ${user_id}`);
    return res.json({
      message: 'Onboarding completed successfully!',
      user_id,
      email,
    });
  } catch (error) {
    console.error('Error in onboard-user:', error);
    next(error);
  }
});

/**
 * POST /api/update-user
 * Create or update user profile
 */
router.post('/update-user', validate(userUpdateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id, wallet_address } = req.body as UserUpdateRequest;

    if (!user_id.trim()) {
      return res.status(400).json({
        error: 'Bad Request',
        detail: 'User ID cannot be empty',
      });
    }

    const supabase = getSupabaseClient();

    const profileRecord: any = {
      user_id,
      wallet_address,
      is_premium: false,
      points: 0,
      daily_post_count: 0,
      preferences: {},
      timezone: 'UTC',
      created_at: new Date().toISOString(),
      last_active: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('user_profiles')
      .upsert(profileRecord, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) {
      console.error(`Failed to upsert user profile for user_id: ${user_id}`, error);
      return res.status(500).json({
        error: 'Internal Server Error',
        detail: 'Failed to update user profile',
      });
    }

    console.log(`User profile updated/created for user_id: ${user_id}`);
    return res.json({
      message: 'User profile created successfully',
      user_id,
      requires_onboarding: !data.email,
    });
  } catch (error) {
    console.error('Error in update-user:', error);
    next(error);
  }
});

export default router;
