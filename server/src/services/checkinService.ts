import getSupabaseClient from '../config/supabase';

const supabase = getSupabaseClient();

// Streak milestone rewards
const STREAK_REWARDS: Record<number, number> = {
  5: 2,
  10: 3,
  15: 4,
  20: 5,
  25: 6,
  30: 10
};

const COOLDOWN_HOURS = 24;

export interface CheckInResult {
  success: boolean;
  message: string;
  points_earned?: number;
  total_points?: number;
  streak_day?: number;
  can_check_in: boolean;
  next_checkin_time?: string;
}

export interface CheckInStatus {
  has_checked_in: boolean;
  last_checkin?: string;
  next_available?: string;
  current_streak: number;
  total_points: number;
}

function getStreakRewardPoints(streakDay: number): number {
  return STREAK_REWARDS[streakDay] || 1;
}

function formatTimeRemaining(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);

  return parts.join(' ') || 'less than a minute';
}

export async function getCheckInStatus(userId: string): Promise<CheckInStatus> {
  try {
    // Get user's last check-in from database
    const { data: checkins, error } = await supabase
      .from('checkins')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      console.error('[CHECKIN] Error fetching check-in status:', error);
      throw error;
    }

    // Get user's total points
    const { data: user, error: userError } = await supabase
      .from('user_profiles')
      .select('points, checkin_streak')
      .eq('wallet_address', userId)
      .single();

    if (userError && userError.code !== 'PGRST116') {
      console.error('[CHECKIN] Error fetching user:', userError);
    }

    const lastCheckin = checkins?.[0];
    const totalPoints = user?.points || 0;
    const currentStreak = user?.checkin_streak || 0;

    if (!lastCheckin) {
      return {
        has_checked_in: false,
        current_streak: currentStreak,
        total_points: totalPoints
      };
    }

    const lastCheckinTime = new Date(lastCheckin.created_at);
    const now = new Date();
    const hoursSinceCheckin = (now.getTime() - lastCheckinTime.getTime()) / (1000 * 60 * 60);

    if (hoursSinceCheckin < COOLDOWN_HOURS) {
      const nextAvailable = new Date(lastCheckinTime.getTime() + COOLDOWN_HOURS * 60 * 60 * 1000);
      return {
        has_checked_in: true,
        last_checkin: lastCheckinTime.toISOString(),
        next_available: nextAvailable.toISOString(),
        current_streak: currentStreak,
        total_points: totalPoints
      };
    }

    return {
      has_checked_in: false,
      last_checkin: lastCheckinTime.toISOString(),
      current_streak: currentStreak,
      total_points: totalPoints
    };
  } catch (error) {
    console.error('[CHECKIN] Error getting check-in status:', error);
    return {
      has_checked_in: false,
      current_streak: 0,
      total_points: 0
    };
  }
}

export async function processCheckIn(userId: string): Promise<CheckInResult> {
  try {


    // Check if user can check in
    const status = await getCheckInStatus(userId);

    if (status.has_checked_in && status.next_available) {
      const nextTime = new Date(status.next_available);
      const now = new Date();
      const secondsRemaining = Math.floor((nextTime.getTime() - now.getTime()) / 1000);
      const timeStr = formatTimeRemaining(secondsRemaining);

      return {
        success: false,
        message: `You've already checked in today! Come back in ${timeStr}.`,
        can_check_in: false,
        next_checkin_time: status.next_available,
        total_points: status.total_points
      };
    }

    // Calculate new streak
    let newStreak = 1;
    if (status.last_checkin) {
      const lastTime = new Date(status.last_checkin);
      const now = new Date();
      const hoursSince = (now.getTime() - lastTime.getTime()) / (1000 * 60 * 60);

      // If within 48 hours, continue streak; otherwise reset
      if (hoursSince <= 48) {
        newStreak = status.current_streak + 1;
      }
    }

    const pointsEarned = getStreakRewardPoints(newStreak);
    const newTotalPoints = status.total_points + pointsEarned;

    // Record check-in
    const { error: checkinError } = await supabase
      .from('checkins')
      .insert({
        user_id: userId,
        points_earned: pointsEarned,
        streak_day: newStreak
      });

    if (checkinError) {
      console.error('[CHECKIN] Error recording check-in:', checkinError);
      throw checkinError;
    }

    // Update user's points and streak
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({
        points: newTotalPoints,
        checkin_streak: newStreak,
        last_checkin: new Date().toISOString()
      })
      .eq('wallet_address', userId);

    if (updateError) {
      console.error('[CHECKIN] Error updating user:', updateError);
      // Still consider success if check-in was recorded
    }

    // Generate success message
    const milestones = [5, 10, 15, 20, 25, 30];
    let message: string;

    if (milestones.includes(newStreak)) {
      message = `Milestone Achieved! Day ${newStreak} Streak! +${pointsEarned} points. Total: ${newTotalPoints} points.`;
    } else {
      const nextMilestone = milestones.find(m => m > newStreak) || 30;
      const nextReward = getStreakRewardPoints(nextMilestone);
      message = `Check-in complete! Day ${newStreak} +${pointsEarned} point${pointsEarned > 1 ? 's' : ''}. Total: ${newTotalPoints}. Next milestone: Day ${nextMilestone} for ${nextReward} points!`;
    }



    return {
      success: true,
      message,
      points_earned: pointsEarned,
      total_points: newTotalPoints,
      streak_day: newStreak,
      can_check_in: false
    };

  } catch (error) {
    console.error('[CHECKIN] Error processing check-in:', error);
    return {
      success: false,
      message: 'Failed to process check-in. Please try again.',
      can_check_in: true
    };
  }
}
