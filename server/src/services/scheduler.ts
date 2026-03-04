import cron from "node-cron";
import { getTaskStorageService } from "./taskStorageService";
import { getNotificationService } from "./notificationService";
import { getUserStateService } from "./userStateService";
import { getSuggestionEngine } from "./suggestionEngine";
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

    // Run every minute -- check for due tasks
    cron.schedule("* * * * *", async () => {
      await this.checkDueTasks();
    });

    // Phase 1: Daily wallet snapshot refresh at midnight UTC
    cron.schedule("0 0 * * *", async () => {
      await this.refreshWalletSnapshots();
    });

    // Phase 2: Process event-triggered suggestions every 6 hours
    cron.schedule("0 */6 * * *", async () => {
      await this.processEventSuggestions();
    });

    // Phase 2: Daily proactive scan at 09:00 UTC
    cron.schedule("0 9 * * *", async () => {
      await this.runDailyProactiveScan();
    });

    console.log("[SCHEDULER] Started: task checks (1min) + snapshots (daily) + suggestions (6h) + scan (daily 09:00)");
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

  // ── Phase 1: Wallet Snapshot Refresh ─────────────────────────────

  /**
   * Refreshes wallet snapshots for active users (interacted in the last 7 days).
   * Batches 5 at a time to stay within free-tier RPC limits.
   */
  private async refreshWalletSnapshots() {
    try {
      const userStateService = getUserStateService();
      const activeWallets = await userStateService.getActiveWallets(7);

      if (activeWallets.length === 0) {
        console.log("[SCHEDULER] No active wallets to refresh snapshots for");
        return;
      }

      console.log(`[SCHEDULER] Refreshing snapshots for ${activeWallets.length} active wallets`);

      // Process in batches of 5
      const BATCH_SIZE = 5;
      for (let i = 0; i < activeWallets.length; i += BATCH_SIZE) {
        const batch = activeWallets.slice(i, i + BATCH_SIZE);
        await Promise.allSettled(
          batch.map((addr) => userStateService.updateWalletSnapshot(addr))
        );
        // Small delay between batches to be kind to RPCs
        if (i + BATCH_SIZE < activeWallets.length) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }

      console.log("[SCHEDULER] Wallet snapshot refresh complete");
    } catch (error) {
      console.error("[SCHEDULER] Error refreshing wallet snapshots:", error);
    }
  }

  // ── Phase 2: Event-Triggered Suggestions ─────────────────────

  private async processEventSuggestions() {
    try {
      const userStateService = getUserStateService();
      const engine = getSuggestionEngine();
      const activeWallets = await userStateService.getActiveWallets(7);

      if (activeWallets.length === 0) return;

      console.log(`[SCHEDULER] Processing event suggestions for ${activeWallets.length} wallets`);

      const BATCH_SIZE = 5;
      let totalSuggestions = 0;

      for (let i = 0; i < activeWallets.length; i += BATCH_SIZE) {
        const batch = activeWallets.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map((addr) => engine.processEventSuggestions(addr))
        );

        totalSuggestions += results
          .filter((r): r is PromiseFulfilledResult<number> => r.status === "fulfilled")
          .reduce((sum, r) => sum + r.value, 0);

        if (i + BATCH_SIZE < activeWallets.length) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }

      console.log(`[SCHEDULER] Event suggestions complete: ${totalSuggestions} delivered`);
    } catch (error) {
      console.error("[SCHEDULER] Error processing event suggestions:", error);
    }
  }

  // ── Phase 2: Daily Proactive Scan ──────────────────────────

  private async runDailyProactiveScan() {
    try {
      const userStateService = getUserStateService();
      const engine = getSuggestionEngine();
      const activeWallets = await userStateService.getActiveWallets(7);

      if (activeWallets.length === 0) return;

      console.log(`[SCHEDULER] Running daily proactive scan for ${activeWallets.length} wallets`);

      const BATCH_SIZE = 5;
      let totalSuggestions = 0;

      for (let i = 0; i < activeWallets.length; i += BATCH_SIZE) {
        const batch = activeWallets.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map((addr) => engine.runDailyScan(addr))
        );

        totalSuggestions += results
          .filter((r): r is PromiseFulfilledResult<number> => r.status === "fulfilled")
          .reduce((sum, r) => sum + r.value, 0);

        if (i + BATCH_SIZE < activeWallets.length) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }

      console.log(`[SCHEDULER] Daily scan complete: ${totalSuggestions} suggestions delivered`);
    } catch (error) {
      console.error("[SCHEDULER] Error running daily proactive scan:", error);
    }
  }
}

export const getTaskScheduler = () => TaskScheduler.getInstance();
