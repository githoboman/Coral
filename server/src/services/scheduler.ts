import cron from "node-cron";
import { getTaskStorageService } from "./taskStorageService";
import { getNotificationService } from "./notificationService";
import { WalrusUserManager } from "./walrusUserManager";
import { TicketMinter } from "./ticketMinter";

export class TaskScheduler {
  private static instance: TaskScheduler;
  private taskStorage = getTaskStorageService();
  private notificationService = getNotificationService();
  private userManager = new WalrusUserManager();
  private ticketMinter = new TicketMinter();
  private isRunning = false;

  private constructor() {}

  public static getInstance(): TaskScheduler {
    if (!TaskScheduler.instance) {
      TaskScheduler.instance = new TaskScheduler();
    }
    return TaskScheduler.instance;
  }

  public start() {
    if (this.isRunning) return;
    
    console.log("⏰ Task Scheduler started");
    this.isRunning = true;

    // Run every minute
    cron.schedule("* * * * *", async () => {
      await this.checkDueTasks();
    });
  }

  private async checkDueTasks() {
    try {
      // In a real production app with thousands of users, iterating all users 
      // is not efficient. A dedicated index or separate DB table for due tasks is better.
      // For this implementation given the structure (Wallet/Walrus), we'll do a best-effort approach
      // by iterating known users from the registry.

      const blobId = await this.ticketMinter.getCurrentBlobId();
      if (!blobId) return;

      const registry = await this.userManager.fetchUsersRegistry(blobId);
      if (!registry || !registry.users) return;

      const userIds = Object.keys(registry.users);
      
      for (const userId of userIds) {
        await this.processUserTasks(userId);
      }

    } catch (error) {
      console.error("[SCHEDULER] Error checking due tasks:", error);
    }
  }

  private async processUserTasks(userId: string) {
    try {
      const tasks = await this.taskStorage.getTasks(userId);
      const now = new Date();
      // Find tasks that are due (or past due) and haven't been notified
      const dueTasks = tasks.filter(task => {
        if (!task.due_date || task.status === "completed" || task.due_notification_sent) return false;
        
        const dueDate = new Date(task.due_date);
        // Add a small buffer (e.g. 1 minute) to ensure we catch tasks that just became due
        // But mainly we want to notify when Current Time >= Due Time
        return dueDate <= now;
      });

      for (const task of dueTasks) {
        console.log(`[SCHEDULER] Sending reminder for task ${task.id} to user ${userId}`);
        
        // Send notification
        await this.notificationService.sendTaskDueNotification(userId, task);

        // Mark as notified
        await this.taskStorage.updateTask(userId, task.id, {
          due_notification_sent: true
        });
      }

    } catch (error) {
      // Fail silently for individual users so others process
      // console.error(`[SCHEDULER] Error processing tasks for ${userId}:`, error);
    }
  }
}

export const getTaskScheduler = () => TaskScheduler.getInstance();
