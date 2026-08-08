import { getTelegramService } from "./telegramService";
import { getEmailService } from "./emailService";
import { getSubscriptionService } from "./subscriptionService";
import { getUserManager } from "./userManager";
import { getNotificationCopyService } from "./notificationCopyService";
import { WalletTransaction } from "./blockVisionService";

function timeAgo(timestampMs: number): string {
  const diffMs = Date.now() - timestampMs;
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
}

export class NotificationService {
  private static instance: NotificationService;
  private telegramService = getTelegramService();
  private emailService = getEmailService();
  private subscriptionService = getSubscriptionService();
  private userManager = getUserManager();

  private constructor() { }

  public static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  // Helper to check premium status and get email
  private async getPremiumEmail(walletAddress: string): Promise<string | null> {
    try {
      const subscription = await this.subscriptionService.getCurrentTier(walletAddress);
      if (!subscription.isActivePremium) {
        return null;
      }

      const profile = await this.userManager.getUserProfile(walletAddress);
      if (profile && profile.email) {
        return profile.email;
      }
    } catch (e) {
      console.error('[NotificationService] Error checking premium status:', e);
    }
    return null;
  }

  // Helper to get formatted date
  private formatDate(dateStr?: string): string {
    if (!dateStr) return "ASAP";
    return new Date(dateStr).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  // Helper to get username or default
  private async getUsername(walletAddress: string): Promise<string> {
    try {
      const profile = await this.userManager.getUserProfile(walletAddress);
      if (profile && profile.username) {
        return profile.username;
      }
    } catch (e) {
      console.warn('Error fetching username:', e);
    }
    return "User";
  }

  public async sendNotification(walletAddress: string, message: string): Promise<boolean> {
    const telegramAccount = await this.telegramService.getStatus(walletAddress);
    if (!telegramAccount || !telegramAccount.telegram_chat_id) {
      return false;
    }

    return await this.telegramService.sendMessage(telegramAccount.telegram_chat_id, message);
  }

  // Helper to escape HTML for Telegram
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /**
   * @deprecated — Preserved for rollback. Use dispatchTaskCreatedAlert() instead.
   */
  public async _legacy_sendTaskCreatedNotification(walletAddress: string, task: any) {
    // 1. Telegram (HTML Format)
    const username = await this.getUsername(walletAddress);
    const safeUsername = this.escapeHtml(username);

    const taskName = task.task_name || "New Task";
    const safeTaskName = this.escapeHtml(taskName);

    const rawDesc = task.description ? this.escapeHtml(task.description) : "";
    // Only show description if it's meaningfully different from task name
    const desc = (rawDesc && !rawDesc.toLowerCase().includes(safeTaskName.toLowerCase()) && !safeTaskName.toLowerCase().includes(rawDesc.toLowerCase())) ? rawDesc : "";
    const priority = task.priority ? task.priority.charAt(0).toUpperCase() + task.priority.slice(1) : "Medium";

    const dueDateStr = task.due_date ? new Date(task.due_date).toLocaleString("en-US", {
      month: "numeric", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", second: "2-digit"
    }) : "";

    const descLine = desc ? `\n${desc}` : "";
    const message = `Hey <b>${safeUsername}</b>,\nYou just created a new task!\n\nHere's the <b>Details</b>\n${safeTaskName}${descLine}\n\n<b>Due Date</b>\n${dueDateStr}\n\n<b>Priority</b>\n${priority}\n\nI'd be here to remind you once it is due.\n\nThanks,\nCoral Team`;

    await this.sendNotification(walletAddress, message);

    // 2. Email (Premium only)
    const email = await this.getPremiumEmail(walletAddress);
    if (email) {

      const html = `
        <div style="font-family: sans-serif; padding: 20px; color: #333;">
            <p>Hey <b>${username}</b>,</p>
            <p>You just created a new task!</p>
            
            <p>Here's the <b>Details</b></p>
            <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 10px 0;">
              <p style="font-weight: bold; margin-top: 0;">${taskName}</p>
              ${(task.description && !task.description.toLowerCase().includes(taskName.toLowerCase()) && !taskName.toLowerCase().includes(task.description.toLowerCase())) ? `<p>${task.description}</p>` : ''}
            </div>

            ${task.due_date ? `<p><b>Due Date</b><br>${new Date(task.due_date).toLocaleString("en-US", {
        month: "numeric", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit", second: "2-digit"
      })}</p>` : ''}

            ${task.priority ? `<p><b>Priority</b><br>${task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}</p>` : ''}

            <p>I'd be here to remind you once it is due.</p>
            <p>Thanks,<br>Coral Team</p>
        </div>
        `;
      await this.emailService.sendEmail(email, `New Notification!`, html);
    }
  }

  // ── NEW: Decoupled Parallel Dispatcher — Task Created ──────────────────────
  // Track A (Telegram) and Track B (Email) run simultaneously via Promise.allSettled.
  // Each track has its own try/catch — a failure in one CANNOT affect the other.

  public async dispatchTaskCreatedAlert(walletAddress: string, task: any): Promise<void> {
    const taskId = task.id ?? '?';
    const copyService = getNotificationCopyService();
    const llmCopy = await copyService.generateCopy(task, task.created_at || new Date());

    // ── Track A: Telegram (Standard — always fires) ──────────────────────────
    const telegramTrack = (async () => {
      try {
        const username = await this.getUsername(walletAddress);
        const safeUsername = this.escapeHtml(username);
        const message = `Hey <b>${safeUsername}</b>!\n\nYou just set a new Task to ${this.escapeHtml(llmCopy.task_context)}.\n\nYou said to remind you ${this.escapeHtml(llmCopy.reminder_time_context)}.\n\nSee you soon!`;

        await this.sendNotification(walletAddress, message);
        console.log(`[NOTIFY] Telegram: ✓ Task ${taskId} created alert sent`);
      } catch (err) {
        console.error(`[NOTIFY] Telegram: ✗ Task ${taskId} created alert failed`, err);
      }
    })();

    // ── Track B: Email (Premium — fully isolated from Track A) ──────────────
    const emailTrack = (async () => {
      try {
        const email = await this.getPremiumEmail(walletAddress);
        if (!email) {
          console.log(`[NOTIFY] Email: — Task ${taskId} created alert skipped (not premium or no email)`);
          return;
        }
        const username = await this.getUsername(walletAddress);
        const html = `
          <div style="font-family: sans-serif; padding: 20px; color: #333;">
              <p>Hey <b>${this.escapeHtml(username)}</b>!</p>
              <p>You just set a new Task to ${this.escapeHtml(llmCopy.task_context)}.</p>
              <p>You said to remind you ${this.escapeHtml(llmCopy.reminder_time_context)}.</p>
              <p>See you soon!</p>
          </div>`;

        const ok = await this.emailService.sendEmail(email, `New Notification!`, html);
        if (ok) console.log(`[NOTIFY] Email: ✓ Task ${taskId} created alert sent to ${email}`);
        else    console.warn(`[NOTIFY] Email: ✗ Task ${taskId} created alert — sendEmail returned false`);
      } catch (err) {
        console.error(`[NOTIFY] Email: ✗ Task ${taskId} created alert threw an error`, err);
      }
    })();

    // Fire both tracks simultaneously; settle independently — no throw propagation
    await Promise.allSettled([telegramTrack, emailTrack]);
  }

  /**
   * @deprecated — Preserved for rollback. Use dispatchTaskDueAlert() instead.
   */
  public async _legacy_sendTaskDueNotification(walletAddress: string, task: any) {
    const taskName = task.task_name || "Task";
    const rawDesc = task.description ? task.description : "";
    const desc = (rawDesc && !rawDesc.toLowerCase().includes(taskName.toLowerCase()) && !taskName.toLowerCase().includes(rawDesc.toLowerCase())) ? rawDesc : "";
    const dueDate = this.formatDate(task.due_date);

    // 1. Telegram (HTML Format)
    const username = await this.getUsername(walletAddress);
    const safeUsername = this.escapeHtml(username);
    const safeTaskName = this.escapeHtml(taskName);
    const safeDesc = this.escapeHtml(desc);

    const descLine = desc ? `\n${safeDesc}` : "";
    const message = `Hey <b>${safeUsername}</b>,\n\nYour task is due! Kindly attend to it.\n\nHere's the <b>details of what you asked me to remind you</b>\n\n${safeTaskName}${descLine}\n\n<b>Due Date</b>\n${dueDate}\n\nDo well to schedule more activities, I look forward to helping you stay productive.\n\nThanks,\nCoral Team`;

    await this.sendNotification(walletAddress, message);

    // 2. Email (Premium only)
    const email = await this.getPremiumEmail(walletAddress);
    if (email) {
      const html = `
        <div style="font-family: sans-serif; padding: 20px; color: #333;">
            <p>Hey <b>${username}</b>,</p>
            <p>Your task is due! Kindly attend to it.</p>
            
            <p>Here's the <b>details of what you asked me to remind you</b></p>
            <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 10px 0;">
              <p style="font-weight: bold; margin-top: 0;">${taskName}</p>
              ${(desc) ? `<p>${desc}</p>` : ''}
            </div>

            <p><b>Due Date</b><br>${dueDate}</p>

            <p>Do well to schedule more activities, I look forward to helping you stay productive.</p>
            <p>Thanks,<br>Coral Team</p>
        </div>
        `;
      await this.emailService.sendEmail(email, `Reminder Alert!!`, html);
    }
  }

  // ── NEW: Decoupled Parallel Dispatcher — Task Due ───────────────────────────
  // Track A (Telegram) and Track B (Email) run simultaneously via Promise.allSettled.
  // Each track has its own try/catch — a failure in one CANNOT affect the other.

  public async dispatchTaskDueAlert(walletAddress: string, task: any): Promise<void> {
    const taskId = task.id ?? '?';
    const copyService = getNotificationCopyService();
    const llmCopy = await copyService.generateCopy(task, task.created_at || new Date());

    // ── Track A: Telegram (Standard — always fires) ──────────────────────────
    const telegramTrack = (async () => {
      try {
        const username = await this.getUsername(walletAddress);
        const safeUsername = this.escapeHtml(username);
        const message = `Hey <b>${safeUsername}</b>!\n\nHere to remind you to ${this.escapeHtml(llmCopy.task_context)}.\n\nDo well to schedule more activities, I look forward to helping you stay productive.\n\nWell then, Get to it!`;

        await this.sendNotification(walletAddress, message);
        console.log(`[NOTIFY] Telegram: ✓ Task ${taskId} due alert sent`);
      } catch (err) {
        console.error(`[NOTIFY] Telegram: ✗ Task ${taskId} due alert failed`, err);
      }
    })();

    // ── Track B: Email (Premium — fully isolated from Track A) ──────────────
    const emailTrack = (async () => {
      try {
        const email = await this.getPremiumEmail(walletAddress);
        if (!email) {
          console.log(`[NOTIFY] Email: — Task ${taskId} due alert skipped (not premium or no email)`);
          return;
        }
        const username = await this.getUsername(walletAddress);
        const html = `
          <div style="font-family: sans-serif; padding: 20px; color: #333;">
              <p>Hey <b>${this.escapeHtml(username)}</b>!</p>
              <p>Here to remind you to ${this.escapeHtml(llmCopy.task_context)}.</p>
              <p>Do well to schedule more activities, I look forward to helping you stay productive.</p>
              <p>Well then, Get to it!</p>
          </div>`;

        const ok = await this.emailService.sendEmail(email, `Reminder Alert!!`, html);
        if (ok) console.log(`[NOTIFY] Email: ✓ Task ${taskId} due alert sent to ${email}`);
        else    console.warn(`[NOTIFY] Email: ✗ Task ${taskId} due alert — sendEmail returned false`);
      } catch (err) {
        console.error(`[NOTIFY] Email: ✗ Task ${taskId} due alert threw an error`, err);
      }
    })();

    // Fire both tracks simultaneously; settle independently — no throw propagation
    await Promise.allSettled([telegramTrack, emailTrack]);
  }

  // -- Phase 2: Proactive Suggestion Delivery --

  /**
   * Sends a proactive suggestion via Telegram with Accept/Dismiss inline buttons.
   */
  public async sendSuggestionNotification(
    walletAddress: string,
    suggestionId: number,
    suggestionText: string,
    suggestionType: string
  ): Promise<boolean> {
    const telegramAccount = await this.telegramService.getStatus(walletAddress);
    if (!telegramAccount || !telegramAccount.telegram_chat_id) {
      console.warn(`[NotificationService] No Telegram linked for ${walletAddress.slice(0, 10)}...`);
      return false;
    }

    // Format the suggestion message
    const typeLabels: Record<string, string> = {
      research_new_token: "New Token Detected",
      stake_idle: "Staking Opportunity",
      price_alert: "Price Alert Suggestion",
      portfolio_review: "Portfolio Review",
      research_followup: "Research Follow-up",
      trending_token: "Trending Token",
      epoch_reward: "Staking Reward",
    };

    const label = typeLabels[suggestionType] || "Suggestion";

    const message =
      `<b>Coral Suggestion</b>\n` +
      `<i>${label}</i>\n\n` +
      `${this.escapeHtml(suggestionText)}\n\n` +
      `<i>Tap Accept to create a task, or Dismiss to skip.</i>`;

    const buttons = [
      { text: "Accept", callbackData: `suggestion:accept:${suggestionId}` },
      { text: "Dismiss", callbackData: `suggestion:dismiss:${suggestionId}` },
    ];

    return await this.telegramService.sendMessageWithButtons(
      telegramAccount.telegram_chat_id,
      message,
      buttons,
      'HTML'
    );
  }

  // -- Phase 4: Simulation Result Delivery --

  /**
   * Sends a simulation result via Telegram with Execute/Dismiss inline buttons.
   */
  public async sendSimulationResult(
    walletAddress: string,
    simulationId: number,
    narrative: string,
    warnings: string[],
    simulationType: string
  ): Promise<boolean> {
    const telegramAccount = await this.telegramService.getStatus(walletAddress);
    if (!telegramAccount || !telegramAccount.telegram_chat_id) {
      return false;
    }

    const typeLabels: Record<string, string> = {
      transfer: "Transfer Simulation",
      swap: "Swap Estimation",
      stake: "Staking Simulation",
    };
    const label = typeLabels[simulationType] || "Simulation";

    let message =
      `<b>Coral ${label}</b>\n\n` +
      `${this.escapeHtml(narrative)}`;

    if (warnings.length > 0) {
      message += `\n\n<b>Warnings</b>\n`;
      message += warnings.map((w) => `- ${this.escapeHtml(w)}`).join("\n");
    }

    message += `\n\n<i>Tap Execute to proceed with your wallet, or Dismiss to skip.</i>`;

    const buttons = [
      { text: "Execute", callbackData: `simulation:execute:${simulationId}` },
      { text: "Dismiss", callbackData: `simulation:dismiss:${simulationId}` },
    ];

    return await this.telegramService.sendMessageWithButtons(
      telegramAccount.telegram_chat_id,
      message,
      buttons,
      'HTML'
    );
  }

  /**
   * Dispatches a wallet alert to the owner.
   * Follows the parallel dispatch pattern (Telegram Track A / Email Track B).
   */
  public async dispatchWalletAlert(
    ownerAddress: string,
    trackedAddress: string,
    transaction: WalletTransaction
  ): Promise<void> {
    const shortAddress = `${trackedAddress.slice(0, 6)}...${trackedAddress.slice(-4)}`;
    const counterparty = transaction.counterparty || "Unknown";
    const shortCounterparty = counterparty.length > 20 
      ? `${counterparty.slice(0, 6)}...${counterparty.slice(-4)}` 
      : counterparty;
    
    const timeAgoStr = timeAgo(transaction.timestamp);
    const digest = transaction.digest;
    const amount = transaction.amount;

    const network = process.env.SUI_NETWORK || "testnet";
    const explorerUrl = network === "mainnet"
      ? `https://suivision.xyz/txblock/${digest}`
      : `https://${network}.suivision.xyz/txblock/${digest}`;

    // ── Track A: Telegram ─────────────────────────────────────────────
    const telegramTrack = (async () => {
      try {
        const username = await this.getUsername(ownerAddress);
        const safeUsername = this.escapeHtml(username);

        const message =
          `Hey ${safeUsername}!\n\n` +
          `🔔 <b>Wallet Activity Detected</b>\n\n` +
          `<b>${shortAddress}</b> just sent a transaction.\n\n` +
          `<b>Sent</b>\n` +
          `${this.escapeHtml(amount)} → ${this.escapeHtml(shortCounterparty)}\n\n` +
          `<b>Time</b>\n` +
          `${timeAgoStr}\n\n` +
          `<a href="${explorerUrl}">View on SuiVision →</a>`;

        await this.sendNotification(ownerAddress, message);
        console.log(`[NOTIFY] Telegram: ✓ Wallet alert sent for ${shortAddress}`);
      } catch (err) {
        console.error(`[NOTIFY] Telegram: ✗ Wallet alert failed for ${shortAddress}`, err);
      }
    })();

    // ── Track B: Email (Premium only) ────────────────────────────────
    const emailTrack = (async () => {
      try {
        const email = await this.getPremiumEmail(ownerAddress);
        if (!email) return;

        const username = await this.getUsername(ownerAddress);
        const html = `
          <div style="font-family: sans-serif; padding: 20px; color: #333;">
            <p>Hey <b>${this.escapeHtml(username)}</b>!</p>
            
            <p>🔔 <b>Wallet Activity Detected</b></p>

            <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 10px 0;">
              <p><b>Wallet</b><br>${this.escapeHtml(shortAddress)}</p>
              <p><b>Sent</b><br>${this.escapeHtml(amount)} → ${this.escapeHtml(shortCounterparty)}</p>
              <p><b>Time</b><br>${timeAgoStr}</p>
            </div>

            <p><a href="${explorerUrl}">View on SuiVision →</a></p>

            <p>Stay on top of it!<br>Coral Team</p>
          </div>`;

        const ok = await this.emailService.sendEmail(email, `🔔 Wallet Activity: Outgoing ${amount}`, html);
        if (ok) console.log(`[NOTIFY] Email: ✓ Wallet alert sent to ${email}`);
      } catch (err) {
        console.error(`[NOTIFY] Email: ✗ Wallet alert failed`, err);
      }
    })();

    await Promise.allSettled([telegramTrack, emailTrack]);
  }
}

export const getNotificationService = () => NotificationService.getInstance();
