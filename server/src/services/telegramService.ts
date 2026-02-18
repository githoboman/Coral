import { Telegraf, Context } from 'telegraf';
import { getSupabaseClient } from '../config/supabase';

export interface TelegramAccount {
  wallet_address: string;
  telegram_user_id: string;
  telegram_username?: string;
  telegram_chat_id?: string;
  created_at?: string;
}

export class TelegramService {
  private static instance: TelegramService;
  private bot: Telegraf | null = null;
  private supabase = getSupabaseClient();
  private botUsername: string = '';

  private constructor() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (token) {
      this.bot = new Telegraf(token);
      this.setupBot();
    } else {
      console.warn('TELEGRAM_BOT_TOKEN not found, Telegram service disabled');
    }
  }

  public static getInstance(): TelegramService {
    if (!TelegramService.instance) {
      TelegramService.instance = new TelegramService();
    }
    return TelegramService.instance;
  }

  private async setupBot() {
    if (!this.bot) return;

    try {
      const me = await this.bot.telegram.getMe();
      this.botUsername = me.username;
      console.log(`Telegram bot started as @${me.username}`);
    } catch (e) {
      console.error('Failed to get bot info:', e);
    }

    this.bot.start(async (ctx: Context) => {
      // @ts-ignore - payload exists on start command in newer telegraf or via stripping
      // fast way to get payload from /start <payload>
      const payload = ctx.message && 'text' in ctx.message ? ctx.message.text.split(' ')[1] : '';

      if (!payload) {
        return ctx.reply('Welcome to Tovira! Please use the link provided in the Tovira app to connect your account.');
      }

      try {
        const linked = await this.verifyAndLink(payload, ctx.from);
        if (linked) {
          await ctx.reply(`✅ Successfully linked to wallet ${linked.wallet_address.substring(0, 6)}...${linked.wallet_address.substring(linked.wallet_address.length - 4)}!`);
        } else {
          await ctx.reply('❌ Invalid or expired connection code. Please try generating a new link in the app.');
        }
      } catch (error) {
        console.error('Error linking account:', error);
        await ctx.reply('❌ An error occurred while linking your account. Please try again later.');
      }
    });

    this.bot.on('text', async (ctx) => {
      // Ignore commands which are handled by other handlers
      if (ctx.message.text.startsWith('/')) return;

      const text = ctx.message.text.trim();

      // Strict check: Only process if it is EXACTLY a 6-digit number
      // This prevents the bot from replying to normal messages like "hello" or "100 coins"
      if (/^\d{6}$/.test(text)) {
        try {
          // Check if user is already linked
          const telegramUserId = ctx.from.id.toString();
          const { data: existingLink } = await this.supabase
            .from('telegram_accounts')
            .select('wallet_address')
            .eq('telegram_user_id', telegramUserId)
            .single();

          if (existingLink) {
            const addr = existingLink.wallet_address;
            return ctx.reply(`⚠️ You are already linked to wallet ${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}.\nTo unlink, please use the app.`);
          }

          const linked = await this.verifyAndLink(text, ctx.from);
          if (linked) {
            await ctx.reply(`✅ Successfully linked to wallet ${linked.wallet_address.substring(0, 6)}...${linked.wallet_address.substring(linked.wallet_address.length - 4)}!`);
          } else {
            await ctx.reply('❌ Invalid connection code. Please generate a new one in the app.');
          }
        } catch (error) {
          console.error('Error handling telegram message:', error);
          await ctx.reply('❌ An error occurred. Please try again later.');
        }
      }
      // If it's not a code, we simply ignore it effectively allowing other potential handlers (if any were added via middleware) 
      // or simply remaining silent so we don't spam the user.
    });

    this.bot.launch().catch(err => {
      console.error('Failed to launch Telegram bot:', err);
    });

    // Enable graceful stop
    const stopBot = (signal: string) => {
      if (this.bot) {
        this.bot.stop(signal);
      }
    };

    process.once('SIGINT', () => stopBot('SIGINT'));
    process.once('SIGTERM', () => stopBot('SIGTERM'));
  }

  public getBotUsername(): string {
    return this.botUsername;
  }

  // Generate 6-digit code
  public async generateCode(walletAddress: string): Promise<string> {
    // Generate a random 6-character alphanumeric code to avoid collisions and make it slightly harder to guess
    const chars = '0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

    const { error } = await this.supabase
      .from('telegram_codes')
      .insert({
        wallet_address: walletAddress,
        code,
        expires_at: expiresAt,
      });

    if (error) throw error;
    return code;
  }

  private async verifyAndLink(code: string, telegramUser: any): Promise<{ wallet_address: string } | null> {
    if (!telegramUser) return null;

    // Check code
    const { data: codes, error: fetchError } = await this.supabase
      .from('telegram_codes')
      .select('*')
      .eq('code', code)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (fetchError || !codes) return null;

    const walletAddress = codes.wallet_address;
    const telegramUserId = telegramUser.id.toString();
    const telegramUsername = telegramUser.username;

    // Link account
    const { error: linkError } = await this.supabase
      .from('telegram_accounts')
      .upsert({
        wallet_address: walletAddress,
        telegram_user_id: telegramUserId,
        telegram_username: telegramUsername,
        telegram_chat_id: telegramUserId, // Store user ID as chat ID for DM
      }, { onConflict: 'wallet_address' });

    if (linkError) throw linkError;

    // Cleanup used code
    await this.supabase
      .from('telegram_codes')
      .delete()
      .eq('code', code);

    return { wallet_address: walletAddress };
  }

  public async sendMessage(chatId: string | number, message: string, parseMode: 'Markdown' | 'HTML' = 'HTML'): Promise<boolean> {
    if (!this.bot) return false;
    try {
      await this.bot.telegram.sendMessage(chatId, message, { parse_mode: parseMode });
      return true;
    } catch (e) {
      console.error('Failed to send telegram message:', e);
      return false;
    }
  }

  public async unlinkAccount(walletAddress: string): Promise<void> {
    const { error } = await this.supabase
      .from('telegram_accounts')
      .delete()
      .eq('wallet_address', walletAddress);

    if (error) throw error;
  }

  public async getStatus(walletAddress: string): Promise<TelegramAccount | null> {
    const { data, error } = await this.supabase
      .from('telegram_accounts')
      .select('*')
      .eq('wallet_address', walletAddress)
      .maybeSingle();

    if (error) {
      console.error('Error fetching telegram status:', error);
      return null;
    }

    return data;
  }
}

export const getTelegramService = () => TelegramService.getInstance();