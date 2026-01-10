import { Logger } from './logger';
import {
  UserProfile,
  UserSession,
  BlockchainEntry,
  AdvancementInfo,
  PointsRangeGroups,
  SessionLoader,
  BlockchainFetcher,
  CheckinDataLoader,
  LeaderboardFormatOptions
} from './types';

export class LeaderboardCore {
  private logger = Logger.getLogger('LeaderboardCore');
  private registryId: string | null;

  constructor(registryId?: string) {
    this.registryId = registryId || process.env.REGISTRY_ID || null;
  }

  // ==================== Core Profile Creation Methods ====================

  private createProfileFromSession(session: UserSession): UserProfile | null {
    try {
      const userId = String(session.user_id || '');
      if (!userId) {
        return null;
      }

      return {
        profile_id: session.profile_id || `local_${userId}`,
        user_id: userId,
        username: this.extractDisplayName(session, userId),
        points: Number(session.points || 0),
        last_checkin: Number(session.last_checkin || 0),
        is_active: true,
        source: 'local' as const
      };
    } catch (error) {
      this.logger.debug(`Failed to create profile from session: ${error}`);
      return null;
    }
  }

  private createProfileFromBlockchain(entry: BlockchainEntry): UserProfile | null {
    try {
      const userId = String(entry.user_address || '');
      if (!userId) {
        return null;
      }

      return {
        profile_id: entry.profile_id || '',
        user_id: userId,
        username: `User#${userId.slice(-6)}`, // Use last 6 chars
        points: Number(entry.points || 0),
        last_checkin: Number(entry.last_checkin || 0),
        is_active: true,
        source: 'blockchain' as const
      };
    } catch (error) {
      this.logger.debug(`Failed to create profile from blockchain: ${error}`);
      return null;
    }
  }

  private extractDisplayName(session: UserSession, userId: string): string {
    // Priority: display_name > username > email > default
    const displayName = session.display_name || '';
    const username = session.username || '';
    const email = session.email || '';

    if (displayName && displayName.trim() !== '') {
      return displayName;
    }

    if (username && username.trim() !== '') {
      return username.startsWith('@') ? username.slice(1) : username;
    }

    if (email && email.trim() !== '') {
      // Extract name from email: john@example.com → john
      const emailName = email.split('@')[0];
      if (emailName.length > 2) {
        return emailName;
      }
    }

    return `User#${userId.slice(-6)}`;
  }

  private enhanceWithDisplayName(profile: UserProfile, sessions: UserSession[]): UserProfile {
    for (const session of sessions) {
      if (String(session.user_id) === profile.user_id) {
        const displayName = this.extractDisplayName(session, profile.user_id);
        profile.username = displayName;
        break;
      }
    }
    return profile;
  }

  // ==================== Data Loading Methods ====================

  private async loadFromSessions(
    loadSessions: SessionLoader,
    loadCheckinData?: CheckinDataLoader
  ): Promise<UserProfile[]> {
    try {
      const sessions = await loadSessions();
      if (!sessions || sessions.length === 0) {
        return [];
      }

      const profiles: UserProfile[] = [];

      for (const session of sessions) {
        const profile = this.createProfileFromSession(session);
        if (profile && loadCheckinData) {
          const enhancedProfile = await this.enhanceWithCheckinData(profile, session, loadCheckinData);
          profiles.push(enhancedProfile);
        } else if (profile) {
          profiles.push(profile);
        }
      }

      return profiles;

    } catch (error) {
      this.logger.warn(`Failed to load from sessions: ${error}`);
      return [];
    }
  }

  private async loadFromBlockchain(
    fetchBlockchain: BlockchainFetcher,
    loadSessions?: SessionLoader
  ): Promise<UserProfile[]> {
    try {
      if (!this.registryId) {
        this.logger.warn('No registry ID available for blockchain loading');
        return [];
      }

      const blockchainData = await fetchBlockchain(this.registryId);
      if (!blockchainData || blockchainData.length === 0) {
        return [];
      }

      const sessions = loadSessions ? await loadSessions() : [];
      const profiles: UserProfile[] = [];

      for (const entry of blockchainData) {
        const profile = this.createProfileFromBlockchain(entry);
        if (profile) {
          const enhancedProfile = this.enhanceWithDisplayName(profile, sessions);
          profiles.push(enhancedProfile);
        }
      }

      return profiles;

    } catch (error) {
      this.logger.error(`Failed to load from blockchain: ${error}`);
      return [];
    }
  }

  private async enhanceWithCheckinData(
    profile: UserProfile,
    session: UserSession,
    loadCheckinData: CheckinDataLoader
  ): Promise<UserProfile> {
    try {
      const checkinData = await loadCheckinData(profile.user_id, session);
      if (checkinData && typeof checkinData === 'object' && 'total' in checkinData) {
        profile.points = Number(checkinData.total);
      }
    } catch (error) {
      this.logger.debug(`Failed to enhance with checkin data: ${error}`);
    }
    return profile;
  }

  // ==================== Main Public Methods ====================

  async fetchProfiles(
    loadSessions: SessionLoader,
    fetchBlockchain?: BlockchainFetcher,
    loadCheckinData?: CheckinDataLoader
  ): Promise<UserProfile[]> {
    this.logger.info('Fetching leaderboard profiles...');

    const profiles = await this.loadFromSessions(loadSessions, loadCheckinData);

    if (profiles.length > 0) {
      this.logger.info(`Loaded ${profiles.length} users from local storage`);
      return profiles;
    }

    if (fetchBlockchain && this.registryId) {
      this.logger.info('Falling back to blockchain');
      const blockchainProfiles = await this.loadFromBlockchain(fetchBlockchain, loadSessions);
      if (blockchainProfiles.length > 0) {
        this.logger.info(`Loaded ${blockchainProfiles.length} users from blockchain`);
        return blockchainProfiles;
      }
    }

    this.logger.warn('No users found');
    return [];
  }

  // ==================== Ranking and Sorting Methods ====================

  sortProfilesByPoints(profiles: UserProfile[]): UserProfile[] {
    return [...profiles].sort((a, b) => b.points - a.points);
  }

  getUserRankAndPoints(userId: string, sortedProfiles: UserProfile[]): [number | null, number] {
    for (let rank = 0; rank < sortedProfiles.length; rank++) {
      const profile = sortedProfiles[rank];
      if (String(profile.user_id) === String(userId)) {
        return [rank + 1, profile.points];
      }
    }
    return [null, 0];
  }

  getAdvancementInfo(sortedProfiles: UserProfile[], userRank: number): AdvancementInfo {
    if (userRank <= 1 || userRank > sortedProfiles.length) {
      return { points_needed: 0, next_user: null };
    }

    const userIndex = userRank - 1;
    const userPoints = sortedProfiles[userIndex].points;
    const nextUserPoints = sortedProfiles[userIndex - 1].points;
    const pointsNeeded = nextUserPoints - userPoints + 1;

    return {
      points_needed: Math.max(0, pointsNeeded),
      next_user: pointsNeeded > 0 ? sortedProfiles[userIndex - 1] : null
    };
  }

  // ==================== Formatting Methods ====================

  formatLeaderboard(
    sortedProfiles: UserProfile[],
    currentUserId?: string,
    options: LeaderboardFormatOptions = { formatType: 'html', showTop: 10, includeUserPosition: true }
  ): string {
    const { formatType, showTop = 10, includeUserPosition = true } = options;
    
    switch (formatType) {
      case 'json':
        return this.formatJsonLeaderboard(sortedProfiles, currentUserId, showTop);
      case 'html':
        return this.formatHtmlLeaderboard(sortedProfiles, currentUserId, showTop, includeUserPosition);
      case 'markdown':
        return this.formatMarkdownLeaderboard(sortedProfiles, currentUserId, showTop, includeUserPosition);
      default:
        return this.formatPlainLeaderboard(sortedProfiles, currentUserId, showTop, includeUserPosition);
    }
  }

  private formatJsonLeaderboard(
    sortedProfiles: UserProfile[],
    currentUserId?: string,
    showTop: number = 10
  ): string {
    const topProfiles = sortedProfiles.slice(0, showTop);
    const currentUser = currentUserId ? sortedProfiles.find(p => p.user_id === currentUserId) : null;
    const currentUserRank = currentUserId ? this.getUserRankAndPoints(currentUserId, sortedProfiles)[0] : null;

    return JSON.stringify({
      top_players: topProfiles,
      current_user: currentUser ? {
        rank: currentUserRank,
        points: currentUser.points,
        username: currentUser.username
      } : null,
      total_players: sortedProfiles.length,
      timestamp: new Date().toISOString()
    }, null, 2);
  }

  private formatHtmlLeaderboard(
    sortedProfiles: UserProfile[],
    currentUserId?: string,
    showTop: number = 10,
    includeUserPosition: boolean = true
  ): string {
    let leaderboardText = `<div class="leaderboard">\n`;
    leaderboardText += `  <h2>🏆 Leaderboard</h2>\n`;
    leaderboardText += `  <p class="total-users">📊 Total Players: ${sortedProfiles.length}</p>\n`;
    leaderboardText += `  <ol class="top-players">\n`;

    // Display top players
    for (let i = 0; i < Math.min(showTop, sortedProfiles.length); i++) {
      const profile = sortedProfiles[i];
      const displayName = this.escapeHtml(profile.username);
      const points = profile.points;

      let rankClass = '';
      let rankIcon = '';
      
      if (i === 0) {
        rankClass = 'rank-first';
        rankIcon = '🥇';
      } else if (i === 1) {
        rankClass = 'rank-second';
        rankIcon = '🥈';
      } else if (i === 2) {
        rankClass = 'rank-third';
        rankIcon = '🥉';
      }

      const isCurrentUser = currentUserId && profile.user_id === currentUserId;
      const userClass = isCurrentUser ? 'current-user' : '';

      leaderboardText += `    <li class="player ${rankClass} ${userClass}">\n`;
      leaderboardText += `      <span class="rank">${rankIcon} ${i + 1}</span>\n`;
      leaderboardText += `      <span class="name">${displayName}</span>\n`;
      leaderboardText += `      <span class="points">${points} pts</span>\n`;
      leaderboardText += `    </li>\n`;
    }

    leaderboardText += `  </ol>\n`;

    // Add current user position if requested
    if (includeUserPosition && currentUserId) {
      const [userRank, userPoints] = this.getUserRankAndPoints(currentUserId, sortedProfiles);
      const currentUserProfile = sortedProfiles.find(p => p.user_id === currentUserId);

      if (currentUserProfile) {
        leaderboardText += `  <div class="user-position">\n`;
        
        if (userRank) {
          if (userRank <= 10) {
            leaderboardText += `    <p class="congrats">🎉 You're #${userRank} - In the Top 10!</p>\n`;
          } else if (userRank <= 50) {
            leaderboardText += `    <p class="good">📍 You're #${userRank} - In the Top 50!</p>\n`;
          } else {
            leaderboardText += `    <p class="position">📍 Your Position: #${userRank}</p>\n`;
          }

          leaderboardText += `    <p class="user-info">👤 ${this.escapeHtml(currentUserProfile.username)} | ⭐ ${userPoints} points</p>\n`;

          if (userRank > 1 && userRank <= sortedProfiles.length) {
            const advancement = this.getAdvancementInfo(sortedProfiles, userRank);
            if (advancement.points_needed > 0) {
              leaderboardText += `    <p class="advancement">🎯 Need ${advancement.points_needed} point(s) to advance to #${userRank - 1}!</p>\n`;
            }
          }
        } else {
          leaderboardText += `    <p class="not-ranked">📍 You're not on the leaderboard yet!</p>\n`;
          leaderboardText += `    <p class="encouragement">💡 Check in daily to earn points!</p>\n`;
        }

        leaderboardText += `  </div>\n`;
      }
    }

    leaderboardText += `</div>`;
    return leaderboardText;
  }

  private formatMarkdownLeaderboard(
    sortedProfiles: UserProfile[],
    currentUserId?: string,
    showTop: number = 10,
    includeUserPosition: boolean = true
  ): string {
    let leaderboardText = `## 🏆 Leaderboard\n\n`;
    leaderboardText += `**📊 Total Players:** ${sortedProfiles.length}\n\n`;

    // Display top players
    for (let i = 0; i < Math.min(showTop, sortedProfiles.length); i++) {
      const profile = sortedProfiles[i];
      let displayName = profile.username;
      const points = profile.points;

      let rankIcon = '';
      if (i === 0) rankIcon = '🥇';
      else if (i === 1) rankIcon = '🥈';
      else if (i === 2) rankIcon = '🥉';

      const isCurrentUser = currentUserId && profile.user_id === currentUserId;
      const userPrefix = isCurrentUser ? '**→** ' : '';

      leaderboardText += `${rankIcon} **${i + 1}.** ${userPrefix}**${displayName}** - \`${points}\` pts\n`;
    }

    leaderboardText += `\n---\n`;

    // Add current user position
    if (includeUserPosition && currentUserId) {
      const [userRank, userPoints] = this.getUserRankAndPoints(currentUserId, sortedProfiles);
      const currentUserProfile = sortedProfiles.find(p => p.user_id === currentUserId);

      if (currentUserProfile) {
        if (userRank) {
          if (userRank <= 10) {
            leaderboardText += `**🎉 You're #${userRank} - In the Top 10!**\n`;
          } else if (userRank <= 50) {
            leaderboardText += `**📍 You're #${userRank} - In the Top 50!**\n`;
          } else {
            leaderboardText += `**📍 Your Position:** #${userRank}\n`;
          }

          leaderboardText += `**👤 User:** ${currentUserProfile.username} | **⭐ Points:** ${userPoints}\n`;

          if (userRank > 1 && userRank <= sortedProfiles.length) {
            const advancement = this.getAdvancementInfo(sortedProfiles, userRank);
            if (advancement.points_needed > 0) {
              leaderboardText += `**🎯 Need ${advancement.points_needed} point(s) to advance!**\n`;
            }
          }
        } else {
          leaderboardText += `**📍 You're not on the leaderboard yet!**\n`;
          leaderboardText += `**💡 Check in daily to earn points!**\n`;
        }
      }
    }

    return leaderboardText;
  }

  private formatPlainLeaderboard(
    sortedProfiles: UserProfile[],
    currentUserId?: string,
    showTop: number = 10,
    includeUserPosition: boolean = true
  ): string {
    let leaderboardText = `🏆 Leaderboard\n\n`;
    leaderboardText += `📊 Total Players: ${sortedProfiles.length}\n\n`;

    // Display top players
    for (let i = 0; i < Math.min(showTop, sortedProfiles.length); i++) {
      const profile = sortedProfiles[i];
      let displayName = profile.username;
      const points = profile.points;

      let rankIcon = '';
      if (i === 0) rankIcon = '🥇';
      else if (i === 1) rankIcon = '🥈';
      else if (i === 2) rankIcon = '🥉';

      const isCurrentUser = currentUserId && profile.user_id === currentUserId;
      const userPrefix = isCurrentUser ? '→ ' : '';

      leaderboardText += `${rankIcon} ${i + 1}. ${userPrefix}${displayName} - ${points} pts\n`;
    }

    leaderboardText += `\n────────────────────────────\n`;

    // Add current user position
    if (includeUserPosition && currentUserId) {
      const [userRank, userPoints] = this.getUserRankAndPoints(currentUserId, sortedProfiles);
      const currentUserProfile = sortedProfiles.find(p => p.user_id === currentUserId);

      if (currentUserProfile) {
        if (userRank) {
          if (userRank <= 10) {
            leaderboardText += `🎉 You're #${userRank} - In the Top 10!\n`;
          } else if (userRank <= 50) {
            leaderboardText += `📍 You're #${userRank} - In the Top 50!\n`;
          } else {
            leaderboardText += `📍 Your Position: #${userRank}\n`;
          }

          leaderboardText += `👤 User: ${currentUserProfile.username} | ⭐ Points: ${userPoints}\n`;

          if (userRank > 1 && userRank <= sortedProfiles.length) {
            const advancement = this.getAdvancementInfo(sortedProfiles, userRank);
            if (advancement.points_needed > 0) {
              leaderboardText += `🎯 Need ${advancement.points_needed} point(s) to advance!\n`;
            }
          }
        } else {
          leaderboardText += `📍 You're not on the leaderboard yet!\n`;
          leaderboardText += `💡 Check in daily to earn points!\n`;
        }
      }
    }

    return leaderboardText;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ==================== Utility Methods ====================

  filterActiveUsers(profiles: UserProfile[]): UserProfile[] {
    return profiles.filter(profile => profile.is_active);
  }

  groupByPointsRange(profiles: UserProfile[]): PointsRangeGroups {
    const groups: PointsRangeGroups = {
      '0-100': [],
      '101-500': [],
      '501-1000': [],
      '1001-5000': [],
      '5001+': []
    };

    for (const profile of profiles) {
      const points = profile.points;
      if (points <= 100) {
        groups['0-100'].push(profile);
      } else if (points <= 500) {
        groups['101-500'].push(profile);
      } else if (points <= 1000) {
        groups['501-1000'].push(profile);
      } else if (points <= 5000) {
        groups['1001-5000'].push(profile);
      } else {
        groups['5001+'].push(profile);
      }
    }

    return groups;
  }

  // ==================== Web/Mobile Integration Helpers ====================

  getLeaderboardData(
    sortedProfiles: UserProfile[],
    currentUserId?: string,
    limit: number = 100
  ) {
    const limitedProfiles = sortedProfiles.slice(0, limit);
    const [userRank, userPoints] = currentUserId 
      ? this.getUserRankAndPoints(currentUserId, sortedProfiles)
      : [null, 0];
    
    const userProfile = currentUserId 
      ? sortedProfiles.find(p => p.user_id === currentUserId)
      : null;

    const advancement = userRank ? this.getAdvancementInfo(sortedProfiles, userRank) : null;

    return {
      topPlayers: limitedProfiles,
      currentUser: userProfile ? {
        rank: userRank,
        points: userPoints,
        profile: userProfile,
        advancement
      } : null,
      statistics: {
        totalPlayers: sortedProfiles.length,
        averagePoints: Math.round(sortedProfiles.reduce((sum, p) => sum + p.points, 0) / sortedProfiles.length) || 0,
        maxPoints: sortedProfiles[0]?.points || 0,
        pointsDistribution: this.groupByPointsRange(sortedProfiles)
      }
    };
  }
}