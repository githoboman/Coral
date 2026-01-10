import getSupabaseClient from '../config/supabase';

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
    const { data: user, error: fetchError } = await supabase
      .from('user_profiles')
      .select('points')
      .eq('wallet_address', userId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error('[POINTS] Error fetching user:', fetchError);
      return { success: false, points_awarded: 0, total_points: 0 };
    }

    const currentPoints = user?.points || 0;
    const newTotal = currentPoints + pointsToAward;

    // Update points
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({ points: newTotal })
      .eq('wallet_address', userId);

    if (updateError) {
      console.error('[POINTS] Error updating points:', updateError);
      return { success: false, points_awarded: 0, total_points: currentPoints };
    }

    console.log(`[POINTS] Awarded ${pointsToAward} points for ${priority} task completion to ${userId.substring(0, 10)}...`);

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

    // Get today's chat point count from a simple tracking approach
    const { data: todayCheckins, error: checkError } = await supabase
      .from('chat_points')
      .select('points_earned')
      .eq('user_id', userId)
      .gte('created_at', `${today}T00:00:00Z`)
      .lte('created_at', `${today}T23:59:59Z`);

    if (checkError && checkError.code !== 'PGRST116' && !checkError.message.includes('does not exist')) {
      console.error('[POINTS] Error checking chat points:', checkError);
    }

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
    const { data: user, error: fetchError } = await supabase
      .from('user_profiles')
      .select('points')
      .eq('wallet_address', userId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error('[POINTS] Error fetching user:', fetchError);
      return { success: false, points_awarded: 0, total_points: 0 };
    }

    const currentPoints = user?.points || 0;
    const newTotal = currentPoints + pointsToAward;

    // Update user points
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({ points: newTotal })
      .eq('wallet_address', userId);

    if (updateError) {
      console.error('[POINTS] Error updating points:', updateError);
      return { success: false, points_awarded: 0, total_points: currentPoints };
    }

    // Log chat points for daily tracking (table may not exist, that's ok)
    try {
      await supabase
        .from('chat_points')
        .insert({
          user_id: userId,
          points_earned: pointsToAward
        });
    } catch (e) {
      // Table doesn't exist, we'll just skip tracking
    }

    console.log(`[POINTS] Awarded ${pointsToAward} chat points to ${userId.substring(0, 10)}... (${dailyEarned + pointsToAward}/${POINTS_CONFIG.CHAT_DAILY_LIMIT} today)`);

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
