// src/index.ts
import { TaskCoreLogic } from './core/TaskCoreLogic';
import { WebTaskAdapter } from './adapters/WebTaskAdapter';

export { TaskCoreLogic, WebTaskAdapter };
export type * from './types';

// Example usage
function main() {
  console.log('📋 Task Management System - TypeScript');
  
  const adapter = new WebTaskAdapter();
  const userId = 'user_123';
  
  // Example: Create a task
  const result = adapter.processTaskCreation(userId, 'Buy groceries tomorrow at 3pm');
  
  if (result.success) {
    console.log(`✅ Task created: ${result.task_data?.name}`);
    console.log(`📅 Due: ${result.task_data?.due_date}`);
  } else {
    console.log(`❌ Failed: ${result.error}`);
  }
}

// Only run if this file is executed directly
if (require.main === module) {
  main();
}