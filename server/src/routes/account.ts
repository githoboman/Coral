// src/routes/account.ts
import { Router, Request, Response, NextFunction } from 'express';
import { getSupabaseClient } from '../config/supabase';
import { validate, addXpSchema } from '../utils/validation';
import { getXpForLevel, calculateLevelFromXp } from '../utils/account';
import { AccountDetails, LeaderboardEntry, AddXpRequest, AddXpResponse } from '../types';

const router = Router();

/**
 * GET /api/account/:user_id
 * Get user account details with XP/level/rank
 */
router.get('/account/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id } = req.params;

    if (!user_id.trim()) {
      return res.status(400).json({
        error: 'Bad Request',
        detail: 'User ID cannot be empty',
      });
    }

    const supabase = getSupabaseClient();

    // Get user profile - basic columns
    const { data: user, error: userError } = await supabase
      .from('user_profiles')
      .select('user_id, wallet_address, email, username, first_name, last_name, is_premium, created_at')
      .eq('user_id', user_id)
      .single();

    if (userError && userError.code !== 'PGRST116') {
      throw userError;
    }

    if (!user) {
      return res.status(404).json({
        error: 'Not Found',
        detail: 'User not found',
      });
    }

    // Try to get XP and level columns (may not exist)
    let xp = 0;
    let storedLevel = 1;
    let points = 0;
    let referralPoints = 0;

    try {
      const { data: xpData, error: xpError } = await supabase
        .from('user_profiles')
        .select('xp, level, points, referral_points')
        .eq('user_id', user_id)
        .single();

      if (xpData) {
        xp = xpData.xp || 0;
        storedLevel = xpData.level || 1;
        points = xpData.points || 0;
        referralPoints = xpData.referral_points || 0;
      }
    } catch (error) {
      // XP/level columns don't exist, use defaults
      console.log('XP/level columns not found, using defaults');
    }

    // Calculate level and progress
    const [level, currentLevelXp, nextLevelXp] = calculateLevelFromXp(xp);

    // Try to get user's rank (may fail if RPC function doesn't exist)
    let rank: number | null = null;
    try {
      const { data: rankData, error: rankError } = await supabase
        .rpc('get_user_rank', { target_user_id: user_id });

      if (rankData !== null && rankData !== undefined) {
        rank = rankData;
      }
    } catch (error) {
      // Rank feature not available
      console.log('Rank RPC not available');
    }

    const accountDetails: AccountDetails = {
      user_id: user.user_id,
      wallet_address: user.wallet_address,
      email: user.email,
      username: user.username,
      first_name: user.first_name,
      last_name: user.last_name,
      xp,
      level,
      current_level_xp: currentLevelXp,
      next_level_xp: nextLevelXp,
      points,
      referral_points: referralPoints,
      rank: rank ?? undefined,
      is_premium: user.is_premium || false,
      created_at: user.created_at,
    };

    return res.json(accountDetails);
  } catch (error) {
    console.error('Error fetching account:', error);
    next(error);
  }
});

/**
 * GET /api/leaderboard
 * Get top 100 users by XP
 */
router.get('/leaderboard', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = getSupabaseClient();

    // Try to get users with XP/level columns
    let data: any[] = [];
    try {
      const { data: xpData, error: xpError } = await supabase
        .from('user_profiles')
        .select('user_id, wallet_address, username, email, xp, level, points, referral_points')
        .order('xp', { ascending: false })
        .order('level', { ascending: false })
        .order('points', { ascending: false })
        .limit(100);

      if (xpData) {
        data = xpData;
      }
    } catch (error) {
      // XP/level columns don't exist, get basic user info
      const { data: basicData, error: basicError } = await supabase
        .from('user_profiles')
        .select('user_id, wallet_address, username, email')
        .limit(100);

      if (basicData) {
        data = basicData;
      }
    }

    if (!data || data.length === 0) {
      return res.json({ leaderboard: [] });
    }

    // Add rank to each user
    const leaderboard: LeaderboardEntry[] = data.map((user, idx) => {
      const xp = user.xp || 0;
      const [level] = calculateLevelFromXp(xp);

      return {
        rank: idx + 1,
        user_id: user.user_id,
        wallet_address: user.wallet_address,
        username: user.username,
        email: user.email,
        xp,
        level,
        points: user.points || 0,
        referral_points: user.referral_points || 0,
      };
    });

    // Add cache-control headers for 5 minutes
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    return res.json({ leaderboard });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    next(error);
  }
});

/**
 * POST /api/add-xp/:user_id
 * Add XP to user and update their level automatically
 */
router.post('/add-xp/:user_id', validate(addXpSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id } = req.params;
    const { xp_amount } = req.body as AddXpRequest;

    if (!user_id.trim()) {
      return res.status(400).json({
        error: 'Bad Request',
        detail: 'User ID cannot be empty',
      });
    }

    if (xp_amount <= 0) {
      return res.status(400).json({
        error: 'Bad Request',
        detail: 'XP amount must be positive',
      });
    }

    const supabase = getSupabaseClient();

    // Get current user
    const { data: user, error: userError } = await supabase
      .from('user_profiles')
      .select('xp, level')
      .eq('user_id', user_id)
      .single();

    if (userError && userError.code !== 'PGRST116') {
      throw userError;
    }

    if (!user) {
      return res.status(404).json({
        error: 'Not Found',
        detail: 'User not found',
      });
    }

    const currentXp = user.xp || 0;
    const newXp = currentXp + xp_amount;

    // Calculate new level
    const [newLevel] = calculateLevelFromXp(newXp);
    const oldLevel = user.level || 1;

    // Update user
    const { data: updatedUser, error: updateError } = await supabase
      .from('user_profiles')
      .update({
        xp: newXp,
        level: newLevel,
      })
      .eq('user_id', user_id)
      .select()
      .single();

    if (updateError) {
      console.error('Failed to update user XP:', updateError);
      throw updateError;
    }

    const levelUp = newLevel > oldLevel;

    const response: AddXpResponse = {
      message: 'XP added successfully',
      user_id,
      xp_added: xp_amount,
      total_xp: newXp,
      level: newLevel,
      level_up: levelUp,
      levels_gained: levelUp ? newLevel - oldLevel : 0,
    };

    return res.json(response);
  } catch (error) {
    console.error('Error adding XP:', error);
    next(error);
  }
});

export default router;
