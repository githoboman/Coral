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
        .select('points, task_points')
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
        .update({ 
          points: newTotal,
          task_points: (user?.task_points || 0) + pointsToAward 
        })
        .eq('wallet_address', userId);

      if (error) throw error;
    }, 3, 1000, 'Points.updatePoints');

    // NEW: Log to history
    try {
      await withRetry(async () => {
        const { error } = await supabase
          .from('points_history')
          .insert({
            user_id: userId,
            amount: pointsToAward,
            source: 'task_points',
            reason: `Completed ${priority} priority task`,
            details: { priority, points_before: currentPoints, points_after: newTotal }
          });
        if (error) throw error;
      }, 3, 1000, 'Points.logTaskHistory');
    } catch (e) {
      console.warn('[POINTS] Failed to log history, but points were awarded:', e);
    }

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

    // Get today's chat point count from points_history
    const todayHistory = await withRetry(async () => {
      const { data, error } = await supabase
        .from('points_history')
        .select('amount')
        .eq('user_id', userId)
        .eq('source', 'chat_points')
        .gte('created_at', `${today}T00:00:00Z`);

      if (error) throw error;
      return data;
    }, 3, 1000, 'Points.checkDailyLimit');

    const dailyEarned = todayHistory?.reduce((sum, r) => sum + (r.amount || 0), 0) || 0;

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

    // NEW: Log to points_history
    try {
      await withRetry(async () => {
        const { error } = await supabase
          .from('points_history')
          .insert({
            user_id: userId,
            amount: pointsToAward,
            source: 'chat_points',
            reason: 'AI chat message',
            details: { points_before: currentPoints, points_after: newTotal }
          });
        if (error) throw error;
      }, 3, 1000, 'Points.logChatHistory');
    } catch (e) {
      console.warn('[POINTS] Failed to log history, but points were awarded:', e);
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
