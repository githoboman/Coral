import cron from "node-cron";
import { getTaskStorageService } from "./taskStorageService";
import { getNotificationService } from "./notificationService";
import { getUserStateService } from "./userStateService";
import { getSuggestionEngine } from "./suggestionEngine";
import { getBlockVisionService } from "./blockVisionService";
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

    // Run every minute -- check for due tasks and tracked wallets
    cron.schedule("* * * * *", async () => {
      await this.checkDueTasks();
      await this.checkTrackedWallets();
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
      const now = new Date();
      
      // 1. Fetch ALL due tasks across ALL users in one query
      // This is much faster and avoids iterating over user profiles which might be redundant
      const { data: dueTasks, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('status', 'pending')
        .eq('due_notification_sent', false)
        .lte('due_date', now.toISOString());

      if (error) throw error;
      if (!dueTasks || dueTasks.length === 0) return;

      console.log(`[SCHEDULER] Found ${dueTasks.length} tasks due for notification`);

      for (const rawTask of dueTasks) {
        const task = {
          ...rawTask,
          id: rawTask.id.toString(),
          tags: rawTask.tags || []
        };

        // If the due date is more than 5 minutes in the past, the task was missed
        // while the server was offline — silently discard without notifying.
        const STALE_THRESHOLD_MS = 5 * 60 * 1000;
        if (now.getTime() - new Date(task.due_date).getTime() > STALE_THRESHOLD_MS) {
          await this.taskStorage.updateTask(task.user_id, task.id, { due_notification_sent: true });
          continue;
        }

        try {
          // 2. Mark as sent IMMEDIATELY to prevent duplicate triggers in next cron run
          // if the notification takes long or if multiple schedulers are running
          await this.taskStorage.updateTask(task.user_id, task.id, {
            due_notification_sent: true
          });

          // 3. Dispatch notifications — Telegram (Track A) + Email (Track B) in parallel
          await this.notificationService.dispatchTaskDueAlert(task.user_id, task);

          console.log(`[SCHEDULER] Dispatched parallel alert for task ${task.id}`);

          // 4. Handle recurrence (ONLY if explicitly marked or for specific action types)
          // For now, we only reschedule if the user message or tags indicate it, 
          // or we can add a 'recurring' field to TaskData.
          // FIX: Removing the hardcoded 24h reschedule for EVERY task.
          if (task.tags?.includes('recurring') || task.tags?.includes('daily')) {
            const currentDueDate = new Date(task.due_date!);
            const nextDueDate = new Date(currentDueDate.getTime() + 24 * 60 * 60 * 1000);

            await this.taskStorage.updateTask(task.user_id, task.id, {
              due_date: nextDueDate.toISOString(),
              due_notification_sent: false // Reset for next time
            });
            console.log(`[SCHEDULER] Rescheduled recurring task ${task.id} to ${nextDueDate.toISOString()}`);
          }
        } catch (taskErr) {
          console.error(`[SCHEDULER] Failed to process task ${task.id}:`, taskErr);
        }
      }

    } catch (error) {
      console.error("[SCHEDULER] Error checking due tasks:", error);
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

  // ── Wallet Alert Monitoring ────────────────────────────────────────

  private async checkTrackedWallets() {
    try {
      // 1. Fetch all users who have at least one tracked wallet
      const { data: profiles, error } = await supabase
        .from('user_profiles')
        .select('wallet_address, alert_wallets')
        .not('alert_wallets', 'eq', '{}')
        .not('alert_wallets', 'is', null);

      if (error) throw error;
      if (!profiles || profiles.length === 0) return;

      // 2. Flatten into a list of (ownerAddress, trackedAddress) pairs
      const pairs: { owner: string; tracked: string }[] = [];
      for (const profile of profiles) {
        if (profile.alert_wallets && Array.isArray(profile.alert_wallets)) {
          for (const trackedAddress of profile.alert_wallets) {
            pairs.push({ owner: profile.wallet_address, tracked: trackedAddress });
          }
        }
      }

      if (pairs.length === 0) return;

      console.log(`[WALLET ALERTS] Checking ${pairs.length} tracked wallet(s)`);

      // 3. Process in batches of 5 (consistent with existing scheduler pattern)
      const BATCH_SIZE = 5;
      for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
        const batch = pairs.slice(i, i + BATCH_SIZE);
        await Promise.allSettled(
          batch.map(({ owner, tracked }) => this.processTrackedWallet(owner, tracked))
        );
        if (i + BATCH_SIZE < pairs.length) {
          await new Promise((r) => setTimeout(r, 2000)); // Rate limit courtesy delay
        }
      }

    } catch (error) {
      console.error('[WALLET ALERTS] Error in checkTrackedWallets:', error);
    }
  }

  private async processTrackedWallet(ownerAddress: string, trackedAddress: string) {
    try {
      const bv = getBlockVisionService();

      // 1. Get or create the state row for this owner + tracked pair
      const { data: stateRow } = await supabase
        .from('tracked_wallet_state')
        .select('last_seen_digest')
        .eq('owner_user_id', ownerAddress)
        .eq('tracked_address', trackedAddress)
        .single();

      const lastSeenDigest = stateRow?.last_seen_digest ?? null;

      // 2. Fetch the most recent transactions for the tracked wallet
      const transactions = await bv.getRecentTransactions(trackedAddress, 5);

      if (!transactions || transactions.length === 0) return;

      // 3. Find new OUTGOING transactions we haven't seen yet
      const newOutgoing = transactions.filter(tx =>
        tx.type === 'send' &&
        tx.digest !== lastSeenDigest
      );

      // 4. Update last_seen_digest to the most recent transaction (first in list)
      // Do this BEFORE dispatching to prevent duplicate notifications if dispatch is slow
      // Also, if lastSeenDigest was null, we just set the first one without alerting (grace period)
      await supabase
        .from('tracked_wallet_state')
        .upsert({
          owner_user_id: ownerAddress,
          tracked_address: trackedAddress,
          last_seen_digest: transactions[0].digest, // Most recent
          last_checked_at: new Date().toISOString(),
        }, { onConflict: 'owner_user_id,tracked_address' });

      if (!lastSeenDigest) {
        console.log(`[WALLET ALERTS] First-time setup for ${trackedAddress.slice(0, 10)}... (owner ${ownerAddress.slice(0, 10)}...). Digest set.`);
        return;
      }

      if (newOutgoing.length === 0) return;

      // 5. Dispatch notification for each new outgoing transaction
      // If multiple new transactions, only notify for the most recent one to avoid spam
      const latestNew = newOutgoing[0];
      await this.notificationService.dispatchWalletAlert(ownerAddress, trackedAddress, latestNew);

      console.log(`[WALLET ALERTS] Dispatched alert for ${trackedAddress.slice(0, 10)}... → owner ${ownerAddress.slice(0, 10)}...`);

    } catch (error) {
      console.error(`[WALLET ALERTS] Failed to process ${trackedAddress.slice(0, 10)}...:`, error);
    }
  }
}

export const getTaskScheduler = () => TaskScheduler.getInstance();
