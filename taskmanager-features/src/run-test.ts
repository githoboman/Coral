import { TaskCoreLogic } from './core/TaskCoreLogic';
import { WebTaskAdapter } from './adapters/WebTaskAdapter';

async function runAllTests() {
  console.log('🧪 Running Manual Tests...\n');
  let passed = 0;
  let failed = 0;

  try {
    // Test 1: Clean task description
    console.log('Test 1: cleanTaskDescription');
    const cleaned = TaskCoreLogic.cleanTaskDescription('Buy groceries tomorrow at 3pm');
    if (cleaned === 'Buy groceries') {
      console.log('✅ PASSED');
      passed++;
    } else {
      console.log(`❌ FAILED: Expected "Buy groceries", got "${cleaned}"`);
      failed++;
    }

    // Test 2: Daily limit
    console.log('\nTest 2: checkDailyTaskLimit');
    const limitResult = TaskCoreLogic.checkDailyTaskLimit(3);
    if (limitResult.canCreate && limitResult.remaining === 2) {
      console.log('✅ PASSED');
      passed++;
    } else {
      console.log('❌ FAILED');
      failed++;
    }

    // Test 3: Process task input
    console.log('\nTest 3: processTaskInput');
    const processResult = TaskCoreLogic.processTaskInput('Test in 5 minutes', 'UTC', 0);
    if (processResult.success && processResult.task_data) {
      console.log('✅ PASSED');
      passed++;
    } else {
      console.log('❌ FAILED');
      failed++;
    }

    // Test 4: Web adapter
    console.log('\nTest 4: WebTaskAdapter');
    const adapter = new WebTaskAdapter();
    const adapterResult = adapter.processTaskCreation('test_user', 'Task in 10 minutes');
    if (adapterResult.success) {
      console.log('✅ PASSED');
      passed++;
    } else {
      console.log('❌ FAILED');
      failed++;
    }

    console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
    
    if (failed === 0) {
      console.log('\n🎉 All tests passed!');
    } else {
      console.log(`\n⚠️  ${failed} test(s) failed`);
    }

  } catch (error) {
    console.error('❌ Test runner error:', error);
  }
}

// Run tests
runAllTests();