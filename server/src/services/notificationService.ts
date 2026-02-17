import { getTelegramBot } from "./telegramBot";
import { WalrusUserManager, getWalrusUserManager } from "./walrusUserManager";
import { TicketMinter, getTicketMinter } from "./ticketMinter";
import { TaskData } from "./taskStorageService";

export class NotificationService {
  private static instance: NotificationService;
  private userManager = getWalrusUserManager();
  private ticketMinter = getTicketMinter();
  private telegramBot = getTelegramBot();

  private constructor() {}

  public static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  /**
   * Helper to get User Details (Chat ID + Username)
   */
  private async getUserDetails(userId: string): Promise<{ chatId: string; username: string } | null> {
    try {
      const blobId = await this.ticketMinter.getCurrentBlobId();
      if (!blobId) return null;

      const profile = await this.userManager.getUserProfile(blobId, userId);
      if (!profile || !profile.telegram_chat_id) return null;

      // Determine display name: Username -> First Name -> "User"
      let displayName = "User";
      if (profile.username) displayName = profile.username;
      else if (profile.first_name) displayName = profile.first_name;

      return { 
        chatId: profile.telegram_chat_id as string,
        username: displayName
      };
    } catch (error) {
      console.error(`[NOTIFICATION] Error getting user details for ${userId}:`, error);
      return null;
    }
  }

  /**
   * Send a general notification to a user
   */
  public async sendNotification(userId: string, message: string): Promise<boolean> {
    const details = await this.getUserDetails(userId);
    if (!details || !details.chatId) {
      console.log(`[NOTIFICATION] No Telegram chat ID for user ${userId}`);
      return false;
    }

    try {
      await this.telegramBot.sendMessage(details.chatId, message);
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
    const details = await this.getUserDetails(userId);
    if (!details) return;

    const priorityStr = task.priority ? task.priority.charAt(0).toUpperCase() + task.priority.slice(1) : "Medium";
    const taskDetails = task.description || task.task_name;

    const message = `
Hey ${details.username}
You just created a new task!

*${taskDetails}*

*Due Date*
${task.due_date ? new Date(task.due_date).toLocaleString() : 'No due date'}

*Priority* 
${priorityStr}

I'd be here to remind you once it is due.
    `.trim();

    // Use direct sendMessage since we already fetched details
    try {
        await this.telegramBot.sendMessage(details.chatId, message);
    } catch (e) {
        console.error("Failed to send created notification", e);
    }
  }

  /**
   * Notify user about a due task
   */
  public async sendTaskDueNotification(userId: string, task: TaskData) {
    const details = await this.getUserDetails(userId);
    if (!details) return;

    const taskDetails = task.description || task.task_name;

    const message = `
Reminder Alert!!

Hey ${details.username}


Your task is due! Kindly attend to it.

*${taskDetails}*

*Due Date*
${new Date(task.due_date!).toLocaleDateString()}

Do well to schedule more activities, I look forward to helping you stay productive, thanks 😊

Get to it
    `.trim();

     try {
        await this.telegramBot.sendMessage(details.chatId, message);
    } catch (e) {
        console.error("Failed to send due notification", e);
    }
  }
}

export const getNotificationService = () => NotificationService.getInstance();
