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

  private otpStore = new Map<string, { wallet: string; expiresAt: number }>();

  /**
   * Generates a 6-digit OTP for a wallet address.
   * Valid for 5 minutes.
   */
  public generateOTP(wallet: string): string {
    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // Store with 5-minute expiration
    this.otpStore.set(code, {
      wallet,
      expiresAt: Date.now() + 5 * 60 * 1000
    });

    // Cleanup old OTPs lazily (occasional cleanup or just let them sit until verified)
    // For simplicity, we won't run a cron, but we check expiry on verify.

    return code;
  }

  /**
   * Verifies an OTP code.
   * Returns the wallet address if valid, null otherwise.
   * Deletes the OTP after successful verification.
   */
  public verifyOTP(code: string): string | null {
    const entry = this.otpStore.get(code);

    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.otpStore.delete(code);
      return null;
    }

    // Valid
    this.otpStore.delete(code);
    return entry.wallet;
  }

  /**
   * Returns the deep link for a payload (wallet address).
   * @deprecated logic, but kept for backward compat if needed
   */
  public getDeepLink(payload: string): string {
    let botUsername = process.env.TELEGRAM_BOT_USERNAME || process.env.BOT_USERNAME || "ToviraBot";
    if (botUsername.startsWith("@")) {
      botUsername = botUsername.substring(1);
    }
    return `https://t.me/${botUsername}?start=link_${payload}`;
  }

  public getBotUsername(): string {
    let botUsername = process.env.TELEGRAM_BOT_USERNAME || process.env.BOT_USERNAME || "ToviraBot";
    if (!botUsername.startsWith("@")) {
      botUsername = "@" + botUsername;
    }
    return botUsername;
  }
}

export const getTelegramService = () => TelegramService.getInstance();