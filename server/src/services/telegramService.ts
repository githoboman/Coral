import { UserProfile, DecryptedUserProfile } from "./walrusUserManager";

export class TelegramService {
  private static instance: TelegramService;

  private constructor() { }

  public static getInstance(): TelegramService {
    if (!TelegramService.instance) {
      TelegramService.instance = new TelegramService();
    }
    return TelegramService.instance;
  }

  /**
   * Returns the deep link for a payload (wallet address).
   */
  public getDeepLink(payload: string): string {
    let botUsername = process.env.TELEGRAM_BOT_USERNAME || process.env.BOT_USERNAME || "ToviraBot";
    if (botUsername.startsWith("@")) {
      botUsername = botUsername.substring(1);
    }
    return `https://t.me/${botUsername}?start=link_${payload}`;
  }
}

export const getTelegramService = () => TelegramService.getInstance();