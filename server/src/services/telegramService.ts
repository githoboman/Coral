import { randomUUID } from "node:crypto";
import { UserProfile, DecryptedUserProfile } from "./walrusUserManager";

interface LinkToken {
  token: string;
  wallet_address: string;
  expires_at: number;
}

export class TelegramService {
  private static instance: TelegramService;
  private tokens: Map<string, LinkToken> = new Map();
  private TOKEN_TTL = 15 * 60 * 1000; // 15 minutes

  private constructor() { }

  public static getInstance(): TelegramService {
    if (!TelegramService.instance) {
      TelegramService.instance = new TelegramService();
    }
    return TelegramService.instance;
  }

  /**
   * Generates a secure, short-lived token for linking a wallet to Telegram.
   */
  public generateLinkToken(walletAddress: string): string {
    const token = randomUUID();
    const expiresAt = Date.now() + this.TOKEN_TTL;

    this.tokens.set(token, {
      token,
      wallet_address: walletAddress,
      expires_at: expiresAt,
    });

    // Cleanup expired tokens periodically (lazy cleanup)
    this.cleanupTokens();

    return token;
  }

  /**
   * Validates a link token and returns the associated wallet address if valid.
   */
  public validateToken(token: string): string | null {
    const linkData = this.tokens.get(token);

    if (!linkData) return null;

    if (Date.now() > linkData.expires_at) {
      this.tokens.delete(token);
      return null;
    }

    // Token is valid. We don't delete it yet because the bot might need it for a multi-step confirmation,
    // but in a simple flow, it could be deleted now. Let's keep it until consumed by the confirm route.
    return linkData.wallet_address;
  }

  /**
   * Consumes a link token, ensuring it can't be used again.
   */
  public consumeToken(token: string): void {
    this.tokens.delete(token);
  }

  private cleanupTokens(): void {
    const now = Date.now();
    for (const [token, data] of this.tokens.entries()) {
      if (now > data.expires_at) {
        this.tokens.delete(token);
      }
    }
  }

  /**
   * Returns the deep link for a token.
   */
  public getDeepLink(token: string): string {
    const botUsername = process.env.TELEGRAM_BOT_USERNAME || process.env.BOT_USERNAME || "ToviraBot";
    return `https://t.me/${botUsername}?start=link_${token}`;
  }
}

export const getTelegramService = () => TelegramService.getInstance();