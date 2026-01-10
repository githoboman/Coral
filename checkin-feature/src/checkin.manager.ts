import { DateTime, Duration } from 'luxon';
import { Logger } from './logger';
import { getStreakRewardPoints, formatTimeRemaining } from './utils';
import {
  CheckInData,
  SessionData,
  CheckInResult,
  HasCheckedInResult,
  StorageAdapter,
  BlockchainAdapter,
  KeyManagerAdapter
} from './types';

export class CheckInManager {
  private logger = Logger.getLogger('CheckInManager');

  constructor(
    private storageAdapter?: StorageAdapter,
    private blockchainAdapter?: BlockchainAdapter,
    private keyManager?: KeyManagerAdapter
  ) {}

  async hasCheckedInRecently(
    userId: string,
    sessionData: SessionData
  ): Promise<HasCheckedInResult> {
    if (!sessionData) {
      return { has_checked_in: false };
    }

    const now = DateTime.utc();
    const password = sessionData.password;
    const profileId = sessionData.profile_id;

    // PRIORITY 1: Check encrypted local file (most reliable)
    if (password && this.storageAdapter) {
      try {
        const data = await this.storageAdapter.loadUserCheckinData(userId, password);
        const lastTs = data.last_checkin;
        if (lastTs) {
          const lastCheckin = DateTime.fromMillis(lastTs, { zone: 'utc' });
          const timeSinceCheckin = now.diff(lastCheckin);
          
          if (timeSinceCheckin.as('hours') < 24) {
            const nextAvailable = lastCheckin.plus({ hours: 24 });
            return {
              has_checked_in: true,
              last_checkin: lastCheckin.toJSDate(),
              next_available: nextAvailable.toJSDate()
            };
          }
        }
      } catch (error) {
        this.logger.debug(`Failed to read local checkin data: ${error}`);
      }
    }

    // PRIORITY 2: Check session data
    const lastCheckinStr = sessionData.last_checkin;
    if (lastCheckinStr) {
      try {
        const lastCheckin = DateTime.fromISO(lastCheckinStr.replace('Z', '+00:00'), { zone: 'utc' });
        const timeSinceCheckin = now.diff(lastCheckin);
        
        if (timeSinceCheckin.as('hours') < 24) {
          const nextAvailable = lastCheckin.plus({ hours: 24 });
          return {
            has_checked_in: true,
            last_checkin: lastCheckin.toJSDate(),
            next_available: nextAvailable.toJSDate()
          };
        }
      } catch (error) {
        this.logger.debug(`Failed to parse session last_checkin: ${error}`);
      }
    }

    // PRIORITY 3: Check blockchain (slowest)
    if (profileId && this.blockchainAdapter) {
      try {
        const profile = await this.blockchainAdapter.getUserDetails(profileId);
        if (profile && profile.last_checkin) {
          const lastTs = parseInt(profile.last_checkin);
          const lastCheckin = DateTime.fromMillis(lastTs, { zone: 'utc' });
          const timeSinceCheckin = now.diff(lastCheckin);
          
          if (timeSinceCheckin.as('hours') < 24) {
            const nextAvailable = lastCheckin.plus({ hours: 24 });
            return {
              has_checked_in: true,
              last_checkin: lastCheckin.toJSDate(),
              next_available: nextAvailable.toJSDate()
            };
          }
        }
      } catch (error) {
        this.logger.debug(`Blockchain check failed: ${error}`);
      }
    }

    return { has_checked_in: false };
  }

  async recordCheckIn(
    userId: string,
    sessionData: SessionData
  ): Promise<[boolean, SessionData]> {
    this.logger.debug(`Recording check-in for user ${userId}`);
    
    try {
      if (!sessionData) {
        return [false, {}];
      }

      const profileId = sessionData.profile_id;
      const password = sessionData.password;

      const currentTimestampMs = DateTime.utc().toMillis();
      const currentTimeUtc = DateTime.utc();

      const checkinEntry = {
        timestamp: currentTimestampMs,
        date: currentTimeUtc.toFormat('yyyy-MM-dd'),
        points_earned: 1
      };

      // Load + update check-in history
      let checkinData: CheckInData = { checkins: [], total: 0, last_checkin: null };
      
      if (password && this.storageAdapter) {
        try {
          checkinData = await this.storageAdapter.loadUserCheckinData(userId, password);
        } catch {
          // Start fresh if no file exists
        }
      }

      checkinData.checkins.push(checkinEntry);
      checkinData.total = checkinData.checkins.length;
      checkinData.last_checkin = currentTimestampMs;

      // Save encrypted backup
      if (password && this.storageAdapter) {
        await this.storageAdapter.saveUserCheckinData(userId, password, checkinData);
      }

      // Update external storage and blockchain
      if (this.keyManager && this.storageAdapter && this.blockchainAdapter) {
        const publicKey = await this.keyManager.getUserPublicKey(userId);
        if (publicKey && profileId) {
          const blobId = await this.storageAdapter.storeEncryptedUserData(publicKey, checkinData);
          if (blobId) {
            await this.blockchainAdapter.updateEncryptedData(profileId, blobId);
          }
        }
      }

      // Update session data
      sessionData.points = (sessionData.points || 0) + 1;
      sessionData.last_checkin = currentTimeUtc.toISO();
      sessionData.checkin_count = checkinData.total;

      return [true, sessionData];
    } catch (error) {
      this.logger.error(`Error recording check-in: ${error}`, error);
      return [false, sessionData];
    }
  }

  async processCheckIn(
    userId: string,
    sessionData: SessionData
  ): Promise<CheckInResult> {
    try {
      // Check if user has already checked in recently
      const { has_checked_in, last_checkin, next_available } = await this.hasCheckedInRecently(
        userId,
        sessionData
      );

      if (has_checked_in && next_available) {
        const now = DateTime.utc();
        const nextCheckin = DateTime.fromJSDate(next_available);
        const timeRemaining = nextCheckin.diff(now);
        const totalSeconds = Math.floor(timeRemaining.as('seconds'));
        
        const countdownStr = formatTimeRemaining(totalSeconds);

        return {
          success: false,
          message: `⏰ **You've already checked in today!**\n\n🔄 Check back in ${countdownStr} for your next point! ⭐`,
          can_check_in_again: false,
          next_checkin_time: next_available
        };
      }

      // If we get here, user can check in
      if (!sessionData) {
        return {
          success: false,
          message: "❌ Session not found. Please set up your account.",
          can_check_in_again: true
        };
      }

      const profileId = sessionData.profile_id;
      const sessionStatus = sessionData.status || 'local_only';
      const password = sessionData.password;

      // Determine current streak from encrypted check-in file
      let currentStreak = (sessionData.checkin_count || 0) + 1;
      
      if (password && this.storageAdapter) {
        try {
          const checkinData = await this.storageAdapter.loadUserCheckinData(userId, password);
          currentStreak = (checkinData.total || 0) + 1;
        } catch {
          // fallback to session
        }
      }

      const pointsEarnedToday = getStreakRewardPoints(currentStreak);

      // Blockchain mode check-in
      if (profileId && sessionStatus === 'blockchain' && this.blockchainAdapter) {
        try {
          const success = await this.blockchainAdapter.checkin(profileId);
          if (!success) {
            return {
              success: false,
              message: "❌ Blockchain check-in failed. Try again later.",
              can_check_in_again: true
            };
          }
        } catch (error) {
          this.logger.error(`Blockchain checkin error: ${error}`);
          return {
            success: false,
            message: "❌ Check-in failed. Please try again.",
            can_check_in_again: true
          };
        }
      }

      // Record check-in
      const [success, updatedSession] = await this.recordCheckIn(userId, sessionData);
      if (!success) {
        return {
          success: false,
          message: "❌ Failed to record check-in.",
          can_check_in_again: true
        };
      }

      const totalPoints = updatedSession.points || 0;

      // Generate success message
      const milestoneDays = [5, 10, 15, 20, 25, 30];
      let msg: string;
      
      if (milestoneDays.includes(currentStreak)) {
        const emoji = currentStreak === 30 ? "🎆" : "🎉";
        msg = `**🎊 MILESTONE ACHIEVED! ${emoji}**\n\n` +
              `**🔥 ${currentStreak}-Day Streak!**\n` +
              `**✨ Bonus Reward:** ${pointsEarnedToday} points today!\n\n` +
              `**⭐ Total Points:** ${totalPoints}\n\n` +
              `${currentStreak === 30 ? '🏆 LEGEND STATUS! 30-Day Streak = 10 POINTS! 🏆' : '💪 Keep the streak going! Amazing work!'}`;
      } else {
        const nextMilestone = milestoneDays.find(d => d > currentStreak);
        const nextReward = nextMilestone ? getStreakRewardPoints(nextMilestone) : 1;
        msg = `✅ **Daily Check-in Complete!**\n\n` +
              `**📅 Day ${currentStreak}** → +${pointsEarnedToday} point${pointsEarnedToday > 1 ? 's' : ''} ⭐\n` +
              `**🏆 Total Points:** ${totalPoints}\n\n` +
              `**🎯 Next Goal:** Day ${nextMilestone || '∞'} → **${nextReward} points!** 🚀`;
      }

      return {
        success: true,
        message: msg,
        points_earned: pointsEarnedToday,
        total_points: totalPoints,
        streak_day: currentStreak,
        can_check_in_again: false,
        updated_session: updatedSession
      };

    } catch (error) {
      this.logger.error(`Error in processCheckIn for ${userId}: ${error}`, error);
      return {
        success: false,
        message: "❌ An unexpected error occurred. Please try again.",
        can_check_in_again: true
      };
    }
  }

  formatCooldownMessage(nextAvailable: Date): string {
    const now = DateTime.utc();
    const nextCheckin = DateTime.fromJSDate(nextAvailable);
    const timeRemaining = nextCheckin.diff(now);
    const totalSeconds = Math.floor(timeRemaining.as('seconds'));
    
    const countdownStr = formatTimeRemaining(totalSeconds);

    return `📊 Check-in Status\n\n` +
           `Status: ✅ Already Checked In Today\n\n` +
           `⏰ Next check-in available in:\n` +
           `**${countdownStr}** ⭐\n\n` +
           `🔄 Come back later for your next point!`;
  }
}