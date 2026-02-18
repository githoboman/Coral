import { Telegraf, Context } from 'telegraf';
import { getSupabaseClient } from '../config/supabase';
import { getTaskStorageService } from './taskStorageService';
import { getTicketMinter } from './ticketMinter';
import { getSubscriptionService } from './subscriptionService';
import { getWalrusUserManager } from './walrusUserManager';

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
      const payload = ctx.message && 'text' in ctx.message ? ctx.message.text.split(' ')[1] : '';

      // Check if user is already linked
      const existingAccount = await this.getAccountByTelegramId(ctx.from!.id.toString());

      if (!payload) {
        if (existingAccount) {
          const addr = existingAccount.wallet_address;
          return ctx.reply(
            `👋 Welcome back to Tovira!\n\n` +
            `🔗 Linked wallet: ${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}\n\n` +
            `Use /info to see your profile or /tasks to view your tasks.`
          );
        }
        return ctx.reply('Welcome to Tovira! Please follow the process indicated in the Tovira app to connect your account.');
      }

      // If already linked, don't re-link
      if (existingAccount) {
        const addr = existingAccount.wallet_address;
        return ctx.reply(
          `⚠️ You are already linked to wallet ${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}.\n` +
          `To unlink, please use the app.`
        );
      }

      try {
        const linked = await this.verifyAndLink(payload, ctx.from);
        if (linked) {
          await ctx.reply(
            `✅ Successfully linked to wallet ${linked.wallet_address.substring(0, 6)}...${linked.wallet_address.substring(linked.wallet_address.length - 4)}!\n\n` +
            `Use /info to see your profile or /tasks to view your tasks.`
          );
        } else {
          await ctx.reply('❌ Invalid or expired connection code. Please try generating a new link in the app.');
        }
      } catch (error) {
        console.error('Error linking account:', error);
        await ctx.reply('❌ An error occurred while linking your account. Please try again later.');
      }
    });

    // /info command - show linked profile
    this.bot.command('info', async (ctx) => {
      try {
        const account = await this.getAccountByTelegramId(ctx.from.id.toString());
        if (!account) {
          return ctx.reply('❌ Your Telegram is not linked to any Tovira account.\nPlease link it from the Tovira app first.');
        }

        const addr = account.wallet_address;

        // Fetch dashboard username from Walrus profile
        let displayName = 'Unknown';
        let streak = 0;
        try {
          const blobId = await getTicketMinter().getCurrentBlobId();
          if (blobId) {
            const profile = await getWalrusUserManager().getUserProfile(blobId, addr);
            if (profile) {
              displayName = profile.username || profile.first_name || 'Unknown';
              streak = profile.current_streak || 0;
            }
          }
        } catch (e) {
          console.error('Error fetching Walrus profile for /info:', e);
        }

        // Fetch subscription tier
        let planLabel = 'Free';
        try {
          const sub = await getSubscriptionService().getCurrentTier(addr);
          if (sub.isActivePremium) planLabel = 'Premium';
        } catch (e) {
          console.error('Error fetching subscription for /info:', e);
        }

        const connectedAt = account.created_at ? new Date(account.created_at).toLocaleDateString() : 'Unknown';

        await ctx.reply(
          `🏙 *Your Tovira Profile*\n\n` +
          `👤 User: ${displayName}\n` +
          `👛 Wallet: \`${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}\`\n` +
          `💎 Plan: ${planLabel}\n` +
          `🔥 Streak: ${streak} days\n` +
          `📅 Connected: ${connectedAt}\n`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        console.error('Error handling /info:', error);
        await ctx.reply('❌ An error occurred. Please try again later.');
      }
    });

    // /tasks command - show task stats summary
    this.bot.command('tasks', async (ctx) => {
      try {
        const account = await this.getAccountByTelegramId(ctx.from.id.toString());
        if (!account) {
          return ctx.reply('❌ Your Telegram is not linked to any Tovira account.\nPlease link it from the Tovira app first.');
        }

        const taskStorage = getTaskStorageService();
        const tasks = await taskStorage.getTasks(account.wallet_address);

        const total = tasks.length;
        const pending = tasks.filter(t => t.status === 'pending').length;
        const completed = tasks.filter(t => t.status === 'completed').length;
        const overdue = tasks.filter(t =>
          t.status === 'pending' && t.due_date && new Date(t.due_date) < new Date()
        ).length;

        await ctx.reply(
          `� *Your Tasks*\n\n` +
          `Total: ${total}\n` +
          `🟡 Pending: ${pending}\n` +
          `🟢 Completed: ${completed}\n` +
          `🔴 Overdue: ${overdue}\n\n` +
          `_Detailed list is available on the dashboard._`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        console.error('Error handling /tasks:', error);
        await ctx.reply('❌ An error occurred. Please try again later.');
      }
    });

    this.bot.on('text', async (ctx) => {
      // Ignore commands which are handled by other handlers
      if (ctx.message.text.startsWith('/')) return;

      const text = ctx.message.text.trim();

      // Strict check: Only process if it is EXACTLY a 6-digit number
      if (/^\d{6}$/.test(text)) {
        try {
          // Check if user is already linked
          const existingAccount = await this.getAccountByTelegramId(ctx.from.id.toString());

          if (existingAccount) {
            const addr = existingAccount.wallet_address;
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

  // Look up linked account by Telegram user ID
  public async getAccountByTelegramId(telegramUserId: string): Promise<TelegramAccount | null> {
    const { data, error } = await this.supabase
      .from('telegram_accounts')
      .select('*')
      .eq('telegram_user_id', telegramUserId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching account by telegram ID:', error);
      return null;
    }

    return data;
  }

  // Generate 6-digit code
  public async generateCode(walletAddress: string): Promise<string> {
    // Clean up expired codes first
    await this.supabase
      .from('telegram_codes')
      .delete()
      .lt('expires_at', new Date().toISOString());

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