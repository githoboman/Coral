import { getTelegramBot } from "./telegramBot";
import { WalrusUserManager } from "./walrusUserManager";
import { TicketMinter } from "./ticketMinter";
import { TaskData } from "./taskStorageService";

export class NotificationService {
  private static instance: NotificationService;
  private userManager = new WalrusUserManager();
  private ticketMinter = new TicketMinter();
  private telegramBot = getTelegramBot();

  private constructor() {}

  public static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  /**
   * Helper to get Telegram Chat ID for a user
   */
  private async getTelegramChatId(userId: string): Promise<string | null> {
    try {
      const blobId = await this.ticketMinter.getCurrentBlobId();
      if (!blobId) return null;

      const profile = await this.userManager.getUserProfile(blobId, userId);
      if (!profile || !profile.telegram_chat_id) return null;

      // Handle encrypted data if necessary (assuming it's decrypted in DecryptedUserProfile,
      // but UserProfile has it as EncryptedData | string. 
      // The userManager.getUserProfile returns DecryptedUserProfile so it should be string)
      return profile.telegram_chat_id as string;
    } catch (error) {
      console.error(`[NOTIFICATION] Error getting chat ID for ${userId}:`, error);
      return null;
    }
  }

  /**
   * Send a general notification to a user
   */
  public async sendNotification(userId: string, message: string): Promise<boolean> {
    const chatId = await this.getTelegramChatId(userId);
    if (!chatId) {
      console.log(`[NOTIFICATION] No Telegram chat ID for user ${userId}`);
      return false;
    }

    try {
      await this.telegramBot.sendMessage(chatId, message);
      console.log(`[NOTIFICATION] Sent to ${userId}: ${message.substring(0, 20)}...`);
      return true;
    } catch (error) {
      console.error(`[NOTIFICATION] Failed to send to ${userId}:`, error);
      return false;
    }
  }

  /**
   * Notify user about a newly created task
   */
  public async sendTaskCreatedNotification(userId: string, task: Partial<TaskData>) {
    const priorityEmoji = 
      task.priority === 'high' ? '🔴' : 
      task.priority === 'medium' ? '🟡' : '🟢';

    const message = `
🆕 *New Task Created*

*${task.task_name}*
${task.description ? `_${task.description}_\n` : ''}
📅 Due: ${task.due_date ? new Date(task.due_date).toLocaleString() : 'No due date'}
${priorityEmoji} Priority: ${task.priority?.toUpperCase()}
    `.trim();

    await this.sendNotification(userId, message);
  }

  /**
   * Notify user about a due task
   */
  public async sendTaskDueNotification(userId: string, task: TaskData) {
    const message = `
⏰ *Task Due Reminder*

*${task.task_name}*
 is due soon!

📅 Due: ${new Date(task.due_date!).toLocaleString()}
    `.trim();

    await this.sendNotification(userId, message);
  }
}

export const getNotificationService = () => NotificationService.getInstance();
