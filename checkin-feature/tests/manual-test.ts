import { CheckInManager } from '../src/checkin.manager';
import { MockStorageAdapter, MockBlockchainAdapter, MockKeyManagerAdapter } from '../src/mock-adapters';
import { DateTime } from 'luxon';
import { SessionData } from '../src/types';

async function runManualTests() {
  console.log('🧪 Running Manual Tests for CheckInManager\n');
  
  const mockStorage = new MockStorageAdapter();
  const mockBlockchain = new MockBlockchainAdapter();
  const mockKeyManager = new MockKeyManagerAdapter();
  
  const manager = new CheckInManager(mockStorage, mockBlockchain, mockKeyManager);
  
  // Test 1: First check-in
  console.log('Test 1: First check-in for new user');
  const session1: SessionData = { points: 0, checkin_count: 0 };
  const result1 = await manager.processCheckIn('user123', session1);
  
  if (result1.success) {
    console.log('✅ SUCCESS:', result1.message);
    console.log(`   Points earned: ${result1.points_earned}`);
    console.log(`   Streak day: ${result1.streak_day}`);
    console.log(`   Total points: ${result1.total_points}`);
  } else {
    console.log('❌ FAILED:', result1.message);
  }
  
  // Test 2: Try to check in again (should fail)
  console.log('\nTest 2: Try double check-in (should fail)');
  const result2 = await manager.processCheckIn('user123', result1.updated_session || {});
  
  if (!result2.success) {
    console.log('✅ SUCCESS: Correctly prevented double check-in');
    console.log('   Message:', result2.message);
    if (result2.next_checkin_time) {
      console.log('   Next check-in:', result2.next_checkin_time);
    }
  } else {
    console.log('❌ FAILED: Should have prevented double check-in');
  }
  
  // Test 3: Check-in after cooldown
  console.log('\nTest 3: Simulate check-in after 24 hours');
  const oldSession: SessionData = {
    points: 10,
    checkin_count: 5,
    last_checkin: DateTime.utc().minus({ hours: 25 }).toISO(),
    password: 'testpass'
  };
  
  // Save previous checkins
  await mockStorage.saveUserCheckinData('user123', 'testpass', {
    checkins: Array(5).fill(null).map((_, i) => ({
      timestamp: Date.now() - (i + 1) * 86400000,
      date: DateTime.utc().minus({ days: i + 1 }).toFormat('yyyy-MM-dd'),
      points_earned: i === 4 ? 2 : 1
    })),
    total: 5,
    last_checkin: Date.now() - 25 * 3600000
  });
  
  const result3 = await manager.processCheckIn('user123', oldSession);
  
  if (result3.success) {
    console.log('✅ SUCCESS: Allowed check-in after cooldown');
    console.log(`   Streak day: ${result3.streak_day}`);
    console.log(`   Points earned: ${result3.points_earned}`);
    console.log(`   Total points: ${result3.total_points}`);
  } else {
    console.log('❌ FAILED:', result3.message);
  }
  
  // Test 4: Milestone achievement (Day 5)
  console.log('\nTest 4: Milestone achievement (Day 5)');
  const session4: SessionData = {
    points: 6,
    checkin_count: 4,
    password: 'milestonepass'
  };
  
  await mockStorage.saveUserCheckinData('user456', 'milestonepass', {
    checkins: Array(4).fill(null).map((_, i) => ({
      timestamp: Date.now() - (i + 1) * 86400000,
      date: DateTime.utc().minus({ days: i + 1 }).toFormat('yyyy-MM-dd'),
      points_earned: 1
    })),
    total: 4,
    last_checkin: Date.now() - 86400000
  });
  
  const result4 = await manager.processCheckIn('user456', session4);
  
  if (result4.success && result4.streak_day === 5) {
    console.log('✅ SUCCESS: Day 5 milestone achieved!');
    console.log('   Message:', result4.message.substring(0, 100) + '...');
    console.log(`   Bonus points: ${result4.points_earned} (should be 2)`);
  } else {
    console.log('❌ FAILED: Should have achieved milestone');
  }
  
  // Test 5: Blockchain mode
  console.log('\nTest 5: Blockchain mode check-in');
  const session5: SessionData = {
    profile_id: 'profile_789',
    status: 'blockchain',
    points: 100,
    checkin_count: 10
  };
  
  
  (mockKeyManager as any).getUserPublicKey = async () => 'mock_public_key';
  
  const result5 = await manager.processCheckIn('user789', session5);
  
  if (result5.success) {
    console.log('✅ SUCCESS: Blockchain check-in worked');
    console.log('   Message:', result5.message.substring(0, 100) + '...');
  } else {
    console.log('❌ FAILED:', result5.message);
  }
  
  // Test 6: Format cooldown message
  console.log('\nTest 6: Format cooldown message');
  const nextTime = DateTime.utc().plus({ hours: 3, minutes: 15, seconds: 45 }).toJSDate();
  const cooldownMsg = manager.formatCooldownMessage(nextTime);
  console.log('✅ Cooldown message formatted:');
  console.log(cooldownMsg);
  
  console.log('\n🎉 All manual tests completed!');
}

// Run the tests
runManualTests().catch(error => {
  console.error('❌ Test runner error:', error);
  process.exit(1);
});