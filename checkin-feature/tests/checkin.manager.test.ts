import { CheckInManager } from '../src/checkin.manager';
import { MockStorageAdapter, MockBlockchainAdapter, MockKeyManagerAdapter } from '../src/mock-adapters';
import { getStreakRewardPoints } from '../src/utils';
import { DateTime } from 'luxon';
import { SessionData } from '../src/types';

describe('CheckInManager', () => {
  let manager: CheckInManager;
  let mockStorage: MockStorageAdapter;
  let mockBlockchain: MockBlockchainAdapter;
  let mockKeyManager: MockKeyManagerAdapter;

  beforeEach(() => {
    mockStorage = new MockStorageAdapter();
    mockBlockchain = new MockBlockchainAdapter();
    mockKeyManager = new MockKeyManagerAdapter();
    manager = new CheckInManager(mockStorage, mockBlockchain, mockKeyManager);
  });

  test('getStreakRewardPoints returns correct points', () => {
    expect(getStreakRewardPoints(1)).toBe(1);
    expect(getStreakRewardPoints(5)).toBe(2);
    expect(getStreakRewardPoints(10)).toBe(3);
    expect(getStreakRewardPoints(15)).toBe(4);
    expect(getStreakRewardPoints(20)).toBe(5);
    expect(getStreakRewardPoints(25)).toBe(6);
    expect(getStreakRewardPoints(30)).toBe(10);
    expect(getStreakRewardPoints(31)).toBe(1);
  });

  test('hasCheckedInRecently returns false for new user', async () => {
    const session: SessionData = {};
    const result = await manager.hasCheckedInRecently('user1', session);
    expect(result.has_checked_in).toBe(false);
  });

  test('hasCheckedInRecently detects recent check-in', async () => {
    const recentTime = DateTime.utc().minus({ hours: 12 }).toISO();
    const session: SessionData = { last_checkin: recentTime };
    
    const result = await manager.hasCheckedInRecently('user1', session);
    expect(result.has_checked_in).toBe(true);
    expect(result.next_available).toBeDefined();
  });

  test('hasCheckedInRecently allows check-in after 24 hours', async () => {
    const oldTime = DateTime.utc().minus({ hours: 25 }).toISO();
    const session: SessionData = { last_checkin: oldTime };
    
    const result = await manager.hasCheckedInRecently('user1', session);
    expect(result.has_checked_in).toBe(false);
  });

  test('processCheckIn successfully checks in new user', async () => {
    const session: SessionData = { points: 0, checkin_count: 0 };
    const result = await manager.processCheckIn('user1', session);
    
    expect(result.success).toBe(true);
    expect(result.points_earned).toBe(1);
    expect(result.streak_day).toBe(1);
    expect(result.total_points).toBe(1);
  });

  test('processCheckIn prevents double check-in', async () => {
    const recentTime = DateTime.utc().minus({ hours: 2 }).toISO();
    const session: SessionData = { 
      last_checkin: recentTime, 
      points: 10 
    };
    
    const result = await manager.processCheckIn('user1', session);
    
    expect(result.success).toBe(false);
    expect(result.can_check_in_again).toBe(false);
    expect(result.message).toContain('already checked in');
  });

  test('processCheckIn handles blockchain mode', async () => {
    const session: SessionData = {
      profile_id: 'profile123',
      status: 'blockchain',
      points: 100,
      checkin_count: 10
    };
    
    const result = await manager.processCheckIn('user789', session);
    
    expect(result.success).toBe(true);
  });

  test('processCheckIn handles local_only mode', async () => {
    const session: SessionData = {
      profile_id: 'profile456',
      status: 'local_only',
      points: 50,
      checkin_count: 5
    };
    
    const result = await manager.processCheckIn('user456', session);
    
    expect(result.success).toBe(true);
  });

  test('recordCheckIn updates session correctly', async () => {
    const session: SessionData = { points: 0 };
    const [success, updatedSession] = await manager.recordCheckIn('user1', session);
    
    expect(success).toBe(true);
    expect(updatedSession.points).toBe(1);
    expect(updatedSession.last_checkin).toBeDefined();
    expect(updatedSession.checkin_count).toBe(1);
  });

test('formatCooldownMessage formats correctly', () => {
  // Mock Date.now to return a fixed time
  const originalDateNow = Date.now;
  Date.now = jest.fn(() => new Date('2024-01-01T12:00:00Z').getTime());
  
  try {
    const nextAvailable = new Date('2024-01-01T17:30:00Z'); // Exactly 5h 30m later
    const message = manager.formatCooldownMessage(nextAvailable);
    
    expect(message).toContain('Already Checked In Today');
    expect(message).toContain('5 hours');
    expect(message).toContain('30 minutes'); // Will always be exact now
  } finally {
    // Restore original Date.now
    Date.now = originalDateNow;
  }
});
});