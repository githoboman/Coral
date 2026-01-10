// WebTaskAdapter.ts
import { TaskPlatformAdapter } from './TaskPlatformAdapter';
import { TaskCoreLogic } from './TaskCoreLogic';
import { UserData, TaskData } from './types';

export class WebTaskAdapter extends TaskPlatformAdapter {
  private userDataStore: Map<string, UserData> = new Map();

  constructor() {
    super(new TaskCoreLogic());
  }

  getUserData(userId: string): UserData {
    // Example: Fetch from database
    if (!this.userDataStore.has(userId)) {
      this.userDataStore.set(userId, {
        session: {
          registration_complete: true,
          profile_id: `user_${userId}`,
          has_encryption_keys: true,
          points: 10,
          last_task_points_time: undefined,
          tasks_completed: 0,
          points_earned_today: 0
        },
        timezone: 'America/New_York',
        daily_task_count: 0
      });
    }
    
    return this.userDataStore.get(userId)!;
  }

  saveUserData(userId: string, data: UserData): void {
    // Example: Save to database
    this.userDataStore.set(userId, data);
  }

  sendMessage(userId: string, message: string, ...kwargs: any[]): void {
    // Example: Send via websocket or email
    console.log(`To user ${userId}: ${message}`);
  }

  createTaskInStorage(userId: string, taskData: TaskData): string | null {
    // Example: Save to database and return ID
    const taskId = `task_${userId}_${Date.now()}`;
    
    // Store task data
    const fullTaskData: TaskData = {
      ...taskData,
      task_id: taskId,
      user_id: userId,
      created_at: new Date().toISOString(),
      status: 'pending'
    };

    // In real implementation, save to database
    console.log(`Created task ${taskId} for user ${userId}: ${taskData.name}`);
    return taskId;
  }

  markTaskCompleted(userId: string, taskId: string): boolean {
    // Example: Update in database
    console.log(`Marked task ${taskId} as completed for user ${userId}`);
    return true;
  }
}