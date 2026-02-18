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

  public async sendNotification(walletAddress: string, message: string): Promise<boolean> {
    const telegramAccount = await this.telegramService.getStatus(walletAddress);
    if (!telegramAccount || !telegramAccount.telegram_chat_id) {
      return false;
    }

    return await this.telegramService.sendMessage(telegramAccount.telegram_chat_id, message);
  }

  public async sendTaskCreatedNotification(walletAddress: string, taskTitle: string) {
    // 1. Telegram
    const message = `📋 New Task Created:\n\nBold: *${taskTitle}*\n\nCheck it out in the app!`;
    await this.sendNotification(walletAddress, message);

    // 2. Email (Premium only)
    const email = await this.getPremiumEmail(walletAddress);
    if (email) {
      const html = `
        <div style="font-family: sans-serif; padding: 20px; color: #333;">
            <h2>📋 New Task Created</h2>
            <p>You have a new task waiting for you:</p>
            <p style="font-size: 18px; font-weight: bold; color: #000;">${taskTitle}</p>
            <p><a href="https://testnet.tovira.xyz" style="color: #00c4b4;">Open App</a></p>
        </div>
        `;
      await this.emailService.sendEmail(email, `New Task: ${taskTitle}`, html);
    }
  }

  public async sendTaskDueNotification(walletAddress: string, taskTitle: string) {
    // 1. Telegram
    const message = `⏰ Task Due Reminder:\n\n*${taskTitle}* is due now!`;
    await this.sendNotification(walletAddress, message);

    // 2. Email (Premium only)
    const email = await this.getPremiumEmail(walletAddress);
    if (email) {
      const html = `
        <div style="font-family: sans-serif; padding: 20px; color: #333;">
            <h2>⏰ Task Due Reminder</h2>
            <p>Your task is due now:</p>
            <p style="font-size: 18px; font-weight: bold; color: #000;">${taskTitle}</p>
            <p><a href="https://testnet.tovira.xyz" style="color: #00c4b4;">Open App</a></p>
        </div>
        `;
      await this.emailService.sendEmail(email, `Task Due: ${taskTitle}`, html);
    }
  }
}

export const getNotificationService = () => NotificationService.getInstance();
