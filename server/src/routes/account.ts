// src/routes/account.ts
import { Router, Request, Response, NextFunction } from 'express';
import { getSupabaseClient } from '../config/supabase';
import { AccountDetails, LeaderboardEntry } from '../types';

const router = Router();

/**
 * GET /api/account/:user_id
 * Get user account details with points and rank
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

    // Get user profile
    const { data: user, error: userError } = await supabase
      .from('user_profiles')
      .select('user_id, wallet_address, email, username, first_name, last_name, is_premium, points, referral_points, created_at')
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

    // Try to get user's rank
    let rank: number | null = null;
    try {
      const { data: rankData } = await supabase
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
      points: user.points || 0,
      referral_points: user.referral_points || 0,
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
 * Get top 100 users by points
 */
router.get('/leaderboard', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('user_profiles')
      .select('user_id, wallet_address, username, email, points, referral_points')
      .order('points', { ascending: false })
      .limit(100);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      return res.json({ leaderboard: [] });
    }

    // Add rank to each user
    const leaderboard: LeaderboardEntry[] = data.map((user, idx) => ({
      rank: idx + 1,
      user_id: user.user_id,
      wallet_address: user.wallet_address,
      username: user.username,
      email: user.email,
      points: user.points || 0,
      referral_points: user.referral_points || 0,
    }));

    // Add cache-control headers for 5 minutes
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    return res.json({ leaderboard });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    next(error);
  }
});

/**
 * POST /api/add-points/:user_id
 * Add points to user
 */
router.post('/add-points/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id } = req.params;
    const { amount } = req.body;

    if (!user_id.trim()) {
      return res.status(400).json({
        error: 'Bad Request',
        detail: 'User ID cannot be empty',
      });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({
        error: 'Bad Request',
        detail: 'Amount must be a positive number',
      });
    }

    const supabase = getSupabaseClient();

    // Get current user
    const { data: user, error: userError } = await supabase
      .from('user_profiles')
      .select('points')
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

    const currentPoints = user.points || 0;
    const newPoints = currentPoints + amount;

    // Update user
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({ points: newPoints })
      .eq('user_id', user_id);

    if (updateError) {
      throw updateError;
    }

    return res.json({
      message: 'Points added successfully',
      user_id,
      points_added: amount,
      total_points: newPoints,
    });
  } catch (error) {
    console.error('Error adding points:', error);
    next(error);
  }
});

export default router;
