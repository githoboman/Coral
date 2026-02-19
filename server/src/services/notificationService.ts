import { getTelegramService } from "./telegramService";
import { getEmailService } from "./emailService";
import { getSubscriptionService } from "./subscriptionService";
import { getWalrusUserManager } from "./walrusUserManager";
import { getTicketMinter } from "./ticketMinter";

export class NotificationService {
  private static instance: NotificationService;
  private telegramService = getTelegramService();
  private emailService = getEmailService();
  private subscriptionService = getSubscriptionService();
  private walrusUserManager = getWalrusUserManager();
  private ticketMinter = getTicketMinter();

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

      const blobId = await this.ticketMinter.getCurrentBlobId();
      if (!blobId) return null;

      const profile = await this.walrusUserManager.getUserProfile(blobId, walletAddress);
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
  private async getUsername(blobId: string, walletAddress: string): Promise<string> {
    try {
      const profile = await this.walrusUserManager.getUserProfile(blobId, walletAddress);
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

  public async sendTaskCreatedNotification(walletAddress: string, task: any) {
    // 1. Telegram (HTML Format)
    const blobId = await this.ticketMinter.getCurrentBlobId();
    const username = blobId ? await this.getUsername(blobId, walletAddress) : "User";
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
    const message = `Hey <b>${safeUsername}</b>,\nYou just created a new task!\n\nHere's the <b>Details</b>\n${safeTaskName}${descLine}\n\n<b>Due Date</b>\n${dueDateStr}\n\n<b>Priority</b>\n${priority}\n\nI'd be here to remind you once it is due.\n\nThanks,\nTovira Team`;

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
            <p>Thanks,<br>Tovira Team</p>
        </div>
        `;
      await this.emailService.sendEmail(email, `New Notification!`, html);
    }
  }

  public async sendTaskDueNotification(walletAddress: string, task: any) {
    const taskName = task.task_name || "Task";
    const rawDesc = task.description ? task.description : "";
    const desc = (rawDesc && !rawDesc.toLowerCase().includes(taskName.toLowerCase()) && !taskName.toLowerCase().includes(rawDesc.toLowerCase())) ? rawDesc : "";
    const dueDate = this.formatDate(task.due_date);

    // 1. Telegram (HTML Format)
    const blobId = await this.ticketMinter.getCurrentBlobId();
    const username = blobId ? await this.getUsername(blobId, walletAddress) : "User";
    const safeUsername = this.escapeHtml(username);
    const safeTaskName = this.escapeHtml(taskName);
    const safeDesc = this.escapeHtml(desc);

    const descLine = desc ? `\n${safeDesc}` : "";
    const message = `Hey <b>${safeUsername}</b>,\n\nYour task is due! Kindly attend to it.\n\nHere's the <b>details of what you asked me to remind you</b>\n\n${safeTaskName}${descLine}\n\n<b>Due Date</b>\n${dueDate}\n\nDo well to schedule more activities, I look forward to helping you stay productive.\n\nThanks,\nTovira Team`;

    await this.sendNotification(walletAddress, message);

    // 2. Email (Premium only)
    const email = await this.getPremiumEmail(walletAddress);
    if (email) {
      const blobId = await this.ticketMinter.getCurrentBlobId();
      const username = blobId ? await this.getUsername(blobId, walletAddress) : "User";

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
            <p>Thanks,<br>Tovira Team</p>
        </div>
        `;
      await this.emailService.sendEmail(email, `Reminder Alert!!`, html);
    }
  }
}

export const getNotificationService = () => NotificationService.getInstance();
