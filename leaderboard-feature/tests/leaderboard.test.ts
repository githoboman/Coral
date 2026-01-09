import { LeaderboardCore } from '../src/leaderboard';
import { UserProfile, UserSession, BlockchainEntry } from '../src/types';

describe('LeaderboardCore', () => {
  let leaderboard: LeaderboardCore;

  beforeEach(() => {
    leaderboard = new LeaderboardCore('test-registry');
  });

  describe('extractDisplayName', () => {
    test('should extract display_name first', () => {
      const session: UserSession = {
        user_id: '123',
        display_name: 'John Doe',
        username: 'johndoe',
        email: 'john@example.com'
      };

      const displayName = (leaderboard as any).extractDisplayName(session, '123');
      expect(displayName).toBe('John Doe');
    });

    test('should use username if no display_name', () => {
      const session: UserSession = {
        user_id: '123',
        username: 'johndoe',
        email: 'john@example.com'
      };

      const displayName = (leaderboard as any).extractDisplayName(session, '123');
      expect(displayName).toBe('johndoe');
    });

    test('should extract from email', () => {
      const session: UserSession = {
        user_id: '123',
        email: 'john@example.com'
      };

      const displayName = (leaderboard as any).extractDisplayName(session, '123');
      expect(displayName).toBe('john');
    });

    test('should use default when no name available', () => {
      const session: UserSession = {
        user_id: '123456789'
      };

      const displayName = (leaderboard as any).extractDisplayName(session, '123456789');
      expect(displayName).toBe('User#456789');
    });
  });

  describe('createProfileFromSession', () => {
    test('should create profile from valid session', () => {
      const session: UserSession = {
        user_id: '123',
        username: 'Alice',
        points: 100,
        profile_id: 'local_123'
      };

      const profile = (leaderboard as any).createProfileFromSession(session);
      expect(profile).toEqual({
        profile_id: 'local_123',
        user_id: '123',
        username: 'Alice',
        points: 100,
        last_checkin: 0,
        is_active: true,
        source: 'local'
      });
    });

    test('should return null for empty user_id', () => {
      const session: UserSession = {
        user_id: '',
        username: 'Alice'
      };

      const profile = (leaderboard as any).createProfileFromSession(session);
      expect(profile).toBeNull();
    });
  });

  describe('createProfileFromBlockchain', () => {
    test('should create profile from valid blockchain entry', () => {
      const entry: BlockchainEntry = {
        user_address: '123',
        profile_id: 'blockchain_123',
        points: '150',
        last_checkin: '1609459200000'
      };

      const profile = (leaderboard as any).createProfileFromBlockchain(entry);
      expect(profile).toEqual({
        profile_id: 'blockchain_123',
        user_id: '123',
        username: 'User#123',
        points: 150,
        last_checkin: 1609459200000,
        is_active: true,
        source: 'blockchain'
      });
    });
  });

  describe('sortProfilesByPoints', () => {
    test('should sort profiles by points descending', () => {
      const profiles: UserProfile[] = [
        { profile_id: '1', user_id: '1', username: 'Alice', points: 100, last_checkin: 0, is_active: true, source: 'local' },
        { profile_id: '2', user_id: '2', username: 'Bob', points: 300, last_checkin: 0, is_active: true, source: 'local' },
        { profile_id: '3', user_id: '3', username: 'Charlie', points: 200, last_checkin: 0, is_active: true, source: 'local' }
      ];

      const sorted = leaderboard.sortProfilesByPoints(profiles);
      expect(sorted[0].username).toBe('Bob');
      expect(sorted[1].username).toBe('Charlie');
      expect(sorted[2].username).toBe('Alice');
    });
  });

  describe('getUserRankAndPoints', () => {
    test('should return rank and points for existing user', () => {
      const profiles: UserProfile[] = [
        { profile_id: '1', user_id: '1', username: 'Alice', points: 300, last_checkin: 0, is_active: true, source: 'local' },
        { profile_id: '2', user_id: '2', username: 'Bob', points: 200, last_checkin: 0, is_active: true, source: 'local' },
        { profile_id: '3', user_id: '3', username: 'Charlie', points: 100, last_checkin: 0, is_active: true, source: 'local' }
      ];

      const [rank, points] = leaderboard.getUserRankAndPoints('3', profiles);
      expect(rank).toBe(3);
      expect(points).toBe(100);
    });

    test('should return null for non-existent user', () => {
      const profiles: UserProfile[] = [
        { profile_id: '1', user_id: '1', username: 'Alice', points: 100, last_checkin: 0, is_active: true, source: 'local' }
      ];

      const [rank, points] = leaderboard.getUserRankAndPoints('999', profiles);
      expect(rank).toBeNull();
      expect(points).toBe(0);
    });
  });

  describe('getAdvancementInfo', () => {
    test('should calculate advancement info', () => {
      const profiles: UserProfile[] = [
        { profile_id: '1', user_id: '1', username: 'Alice', points: 300, last_checkin: 0, is_active: true, source: 'local' },
        { profile_id: '2', user_id: '2', username: 'Bob', points: 200, last_checkin: 0, is_active: true, source: 'local' },
        { profile_id: '3', user_id: '3', username: 'Charlie', points: 100, last_checkin: 0, is_active: true, source: 'local' }
      ];

      const info = leaderboard.getAdvancementInfo(profiles, 3);
      expect(info.points_needed).toBe(101); // 200 - 100 + 1
      expect(info.next_user?.username).toBe('Bob');
    });

    test('should return zero for first place', () => {
      const profiles: UserProfile[] = [
        { profile_id: '1', user_id: '1', username: 'Alice', points: 300, last_checkin: 0, is_active: true, source: 'local' }
      ];

      const info = leaderboard.getAdvancementInfo(profiles, 1);
      expect(info.points_needed).toBe(0);
      expect(info.next_user).toBeNull();
    });
  });

  describe('formatLeaderboard', () => {
    test('should format HTML leaderboard', () => {
      const profiles: UserProfile[] = [
        { profile_id: '1', user_id: '123', username: 'Alice', points: 300, last_checkin: 0, is_active: true, source: 'local' },
        { profile_id: '2', user_id: '456', username: 'Bob', points: 200, last_checkin: 0, is_active: true, source: 'local' }
      ];

      const text = leaderboard.formatLeaderboard(profiles, '456', { formatType: 'html', showTop: 10 });
      expect(text).toContain('🏆 Leaderboard');
      expect(text).toContain('Alice');
      expect(text).toContain('Bob');
    });

    test('should format JSON leaderboard', () => {
      const profiles: UserProfile[] = [
        { profile_id: '1', user_id: '123', username: 'Alice', points: 300, last_checkin: 0, is_active: true, source: 'local' }
      ];

      const jsonText = leaderboard.formatLeaderboard(profiles, '123', { formatType: 'json' });
      const parsed = JSON.parse(jsonText);
      expect(parsed.top_players).toHaveLength(1);
      expect(parsed.current_user.rank).toBe(1);
    });
  });

  describe('fetchProfiles', () => {
    test('should fetch from sessions', async () => {
      const mockSessionLoader = async (): Promise<UserSession[]> => [
        { user_id: '123', username: 'Alice', points: 100 }
      ];

      const profiles = await leaderboard.fetchProfiles(mockSessionLoader);
      expect(profiles).toHaveLength(1);
      expect(profiles[0].username).toBe('Alice');
    });

    test('should fallback to blockchain', async () => {
      const emptySessionLoader = async (): Promise<UserSession[]> => [];
      
      const mockBlockchainFetcher = async (registryId: string): Promise<BlockchainEntry[]> => [
        { user_address: '123', points: 200 }
      ];

      const profiles = await leaderboard.fetchProfiles(emptySessionLoader, mockBlockchainFetcher);
      expect(profiles).toHaveLength(1);
      expect(profiles[0].source).toBe('blockchain');
    });
  });

  describe('groupByPointsRange', () => {
    test('should group profiles by points range', () => {
      const profiles: UserProfile[] = [
        { profile_id: '1', user_id: '1', username: 'Alice', points: 50, last_checkin: 0, is_active: true, source: 'local' },
        { profile_id: '2', user_id: '2', username: 'Bob', points: 300, last_checkin: 0, is_active: true, source: 'local' },
        { profile_id: '3', user_id: '3', username: 'Charlie', points: 1500, last_checkin: 0, is_active: true, source: 'local' },
        { profile_id: '4', user_id: '4', username: 'David', points: 6000, last_checkin: 0, is_active: true, source: 'local' }
      ];

      const groups = leaderboard.groupByPointsRange(profiles);
      expect(groups['0-100']).toHaveLength(1);
      expect(groups['101-500']).toHaveLength(1);
      expect(groups['1001-5000']).toHaveLength(1);
      expect(groups['5001+']).toHaveLength(1);
    });
  });

  describe('filterActiveUsers', () => {
    test('should filter out inactive users', () => {
      const profiles: UserProfile[] = [
        { profile_id: '1', user_id: '1', username: 'Alice', points: 100, last_checkin: 0, is_active: true, source: 'local' },
        { profile_id: '2', user_id: '2', username: 'Bob', points: 200, last_checkin: 0, is_active: false, source: 'local' },
        { profile_id: '3', user_id: '3', username: 'Charlie', points: 300, last_checkin: 0, is_active: true, source: 'local' }
      ];

      const activeProfiles = leaderboard.filterActiveUsers(profiles);
      expect(activeProfiles).toHaveLength(2);
      expect(activeProfiles[0].username).toBe('Alice');
      expect(activeProfiles[1].username).toBe('Charlie');
    });
  });
});
