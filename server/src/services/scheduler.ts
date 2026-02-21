import cron from "node-cron";
import { getTaskStorageService } from "./taskStorageService";
import { getNotificationService } from "./notificationService";
import getSupabaseClient from "../config/supabase";

const supabase = getSupabaseClient();

export class TaskScheduler {
  private static instance: TaskScheduler;
  private taskStorage = getTaskStorageService();
  private notificationService = getNotificationService();
  private isRunning = false;

  private constructor() { }

  public static getInstance(): TaskScheduler {
    if (!TaskScheduler.instance) {
      TaskScheduler.instance = new TaskScheduler();
    }
    return TaskScheduler.instance;
  }

  public start() {
    if (this.isRunning) return;

    this.isRunning = true;

    // Run every minute
    cron.schedule("* * * * *", async () => {
      await this.checkDueTasks();
    });
  }

  private async checkDueTasks() {
    try {
      // Fetch all users from Supabase to check their tasks
      // In a large app, we'd query tasks table directly for due tasks, 
      // but for now we follow the existing pattern of processing per user.
      const { data: users, error } = await supabase
        .from('user_profiles')
        .select('wallet_address');

      if (error) throw error;
      if (!users || users.length === 0) return;

      for (const user of users) {
        if (user.wallet_address) {
          await this.processUserTasks(user.wallet_address);
        }
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


        // Send notification
        await this.notificationService.sendTaskDueNotification(userId, task);

        // RECURRING LOGIC: Reschedule for 24 hours later
        // precisely 24 hours after the *current* due date to maintain the cadence
        const currentDueDate = new Date(task.due_date!);
        const nextDueDate = new Date(currentDueDate.getTime() + 24 * 60 * 60 * 1000);

        await this.taskStorage.updateTask(userId, task.id, {
          due_date: nextDueDate.toISOString(),
          due_notification_sent: false // Reset so it triggers again next time
        });

        console.log(`[SCHEDULER] Rescheduled task ${task.id} to ${nextDueDate.toISOString()}`);
      }

    } catch (error) {
      // Fail silently for individual users so others process
      // console.error(`[SCHEDULER] Error processing tasks for ${userId}:`, error);
    }
  }
}

export const getTaskScheduler = () => TaskScheduler.getInstance();
