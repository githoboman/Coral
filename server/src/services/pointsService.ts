import getSupabaseClient from '../config/supabase';
import { withRetry } from '../utils/retryUtils';

const supabase = getSupabaseClient();

// Points configuration
export const POINTS_CONFIG = {
  TASK_COMPLETION: {
    low: 1,
    medium: 2,
    high: 3
  },
  CHAT_MESSAGE: 1,
  CHAT_DAILY_LIMIT: 5,
};

export interface PointsResult {
  success: boolean;
  points_awarded: number;
  total_points: number;
  message?: string;
}

/**
 * Award points for completing a task
 */
export async function awardTaskCompletionPoints(
  userId: string,
  priority: 'low' | 'medium' | 'high'
): Promise<PointsResult> {
  try {
    const pointsToAward = POINTS_CONFIG.TASK_COMPLETION[priority] || 1;

    // Get current points
    const user = await withRetry(async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('points')
        .eq('wallet_address', userId)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data;
    }, 3, 1000, 'Points.fetchUser');

    const currentPoints = user?.points || 0;
    const newTotal = currentPoints + pointsToAward;

    // Update points
    await withRetry(async () => {
      const { error } = await supabase
        .from('user_profiles')
        .update({ points: newTotal })
        .eq('wallet_address', userId);

      if (error) throw error;
    }, 3, 1000, 'Points.updatePoints');

    return {
      success: true,
      points_awarded: pointsToAward,
      total_points: newTotal,
      message: `+${pointsToAward} points for completing task!`
    };
  } catch (error) {
    console.error('[POINTS] Error awarding task points:', error);
    return { success: false, points_awarded: 0, total_points: 0 };
  }
}

/**
 * Award points for chat usage (with daily limit)
 */
export async function awardChatPoints(userId: string): Promise<PointsResult> {
  try {
    // Check daily chat points usage
    const today = new Date().toISOString().split('T')[0];

    // Get today's chat point count
    const todayCheckins = await withRetry(async () => {
      const { data, error } = await supabase
        .from('chat_points')
        .select('points_earned')
        .eq('user_id', userId)
        .gte('created_at', `${today}T00:00:00Z`)
        .lte('created_at', `${today}T23:59:59Z`);

      if (error && error.code !== 'PGRST116' && !error.message.includes('does not exist')) throw error;
      return data;
    }, 3, 1000, 'Points.checkDailyLimit');

    const dailyEarned = todayCheckins?.reduce((sum, r) => sum + (r.points_earned || 0), 0) || 0;

    if (dailyEarned >= POINTS_CONFIG.CHAT_DAILY_LIMIT) {
      return {
        success: false,
        points_awarded: 0,
        total_points: 0,
        message: `Daily chat points limit (${POINTS_CONFIG.CHAT_DAILY_LIMIT}) reached`
      };
    }

    const pointsToAward = POINTS_CONFIG.CHAT_MESSAGE;

    // Get current points
    const user = await withRetry(async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('points')
        .eq('wallet_address', userId)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data;
    }, 3, 1000, 'Points.fetchUserForChat');

    const currentPoints = user?.points || 0;
    const newTotal = currentPoints + pointsToAward;

    // Update user points
    await withRetry(async () => {
      const { error } = await supabase
        .from('user_profiles')
        .update({ points: newTotal })
        .eq('wallet_address', userId);

      if (error) throw error;
    }, 3, 1000, 'Points.updateUserPoints');

    // Log chat points for daily tracking (table may not exist, that's ok)
    try {
      await withRetry(async () => {
        await supabase
          .from('chat_points')
          .insert({
            user_id: userId,
            points_earned: pointsToAward
          });
      }, 3, 1000, 'Points.logChatPoints');
    } catch (e) {
      // Table doesn't exist or other error, we'll just skip tracking
    }

    return {
      success: true,
      points_awarded: pointsToAward,
      total_points: newTotal,
      message: `+${pointsToAward} point for AI chat`
    };
  } catch (error) {
    console.error('[POINTS] Error awarding chat points:', error);
    return { success: false, points_awarded: 0, total_points: 0 };
  }
}
