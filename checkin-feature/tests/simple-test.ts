// Simple test without Jest
import { CheckInManager } from '../src/checkin.manager';
import { MockStorageAdapter, MockBlockchainAdapter, MockKeyManagerAdapter } from '../src/mock-adapters';
import { getStreakRewardPoints } from '../src/utils';
import { DateTime } from 'luxon';

function runTests() {
  console.log('🧪 Running Simple Tests\n');
  
  let passed = 0;
  let failed = 0;
  
  // Test 1: Streak reward points
  console.log('Test 1: Streak reward points');
  try {
    if (getStreakRewardPoints(1) !== 1) throw new Error('Day 1 should be 1 point');
    if (getStreakRewardPoints(5) !== 2) throw new Error('Day 5 should be 2 points');
    if (getStreakRewardPoints(30) !== 10) throw new Error('Day 30 should be 10 points');
    console.log('✅ PASSED\n');
    passed++;
  } catch (error: any) {
    console.log(`❌ FAILED: ${error.message}\n`);
    failed++;
  }
  
  // Test 2: Create manager
  console.log('Test 2: Create CheckInManager');
  try {
    const mockStorage = new MockStorageAdapter();
    const mockBlockchain = new MockBlockchainAdapter();
    const mockKeyManager = new MockKeyManagerAdapter();
    const manager = new CheckInManager(mockStorage, mockBlockchain, mockKeyManager);
    
    if (!manager) throw new Error('Manager not created');
    console.log('✅ PASSED\n');
    passed++;
  } catch (error: any) {
    console.log(`❌ FAILED: ${error.message}\n`);
    failed++;
  }
  
  // Test 3: First check-in
  console.log('Test 3: First check-in');
  try {
    const mockStorage = new MockStorageAdapter();
    const manager = new CheckInManager(mockStorage);
    const session = { points: 0, checkin_count: 0 };
    
    const result = manager.processCheckIn('user123', session);
    
    result.then((res) => {
      if (res.success && res.points_earned === 1) {
        console.log('✅ PASSED\n');
        passed++;
      } else {
        console.log(`❌ FAILED: ${res.message}\n`);
        failed++;
      }
      printSummary();
    }).catch(error => {
      console.log(`❌ FAILED: ${error.message}\n`);
      failed++;
      printSummary();
    });
  } catch (error: any) {
    console.log(`❌ FAILED: ${error.message}\n`);
    failed++;
    printSummary();
  }
  
  function printSummary() {
    console.log('\n📊 Test Summary:');
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`🎯 Total: ${passed + failed}`);
    
    if (failed === 0) {
      console.log('\n🎉 All tests passed!');
    } else {
      console.log('\n⚠️ Some tests failed');
      process.exit(1);
    }
  }
}

// Run tests
runTests();