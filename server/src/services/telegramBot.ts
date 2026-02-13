import { Telegraf } from "telegraf";
import { getTelegramService } from "./telegramService";
import { WalrusUserManager } from "./walrusUserManager";
import { TicketMinter } from "./ticketMinter";

export class TelegramBot {
  private static instance: TelegramBot;
  private bot: Telegraf | null = null;
  private userManager = new WalrusUserManager();
  private ticketMinter = new TicketMinter();
  
  private log(message: string, ...args: any[]) {
    console.log(`[TELEGRAM BOT] ${message}`, ...args);
  }

  private constructor() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      this.log("⚠️ TELEGRAM_BOT_TOKEN not found in .env. Telegram bot disabled.");
      return;
    }

    this.log(`Initializing with token: ${token.substring(0, 5)}...`);
    this.bot = new Telegraf(token);
    this.setupHandlers();
    
    // Explicitly set polling mode and clear webhook info if any
    this.bot.launch({ dropPendingUpdates: true })
      .then(() => {
        this.log("🚀 Telegram Bot is running...");
      })
      .catch((err) => {
        this.log("❌ Telegram Bot failed to launch:", err.message);
        if (err.message.includes("401")) {
          this.log("   Tip: Check your TELEGRAM_BOT_TOKEN in .env. It might be invalid.");
        }
        this.bot = null; // Disable the bot on failure
      });
      
    // Enable graceful stop
    process.once('SIGINT', () => this.bot?.stop('SIGINT'));
    process.once('SIGTERM', () => this.bot?.stop('SIGTERM'));
  }

  public static getInstance(): TelegramBot {
    if (!TelegramBot.instance) {
      TelegramBot.instance = new TelegramBot();
    }
    return TelegramBot.instance;
  }

  private setupHandlers() {
    if (!this.bot) return;

    this.bot.use((ctx, next) => {
      this.log(`Received update type: ${ctx.updateType}`);
      if (ctx.message && 'text' in ctx.message) {
         this.log(`Message from ${ctx.from?.username} (${ctx.from?.id}): ${ctx.message.text}`);
      }
      return next();
    });

    this.bot.start(async (ctx) => {
      this.log("Processing /start command");
      const payload = (ctx as any).payload; 
      this.log(`Payload received: ${payload}`);

      if (payload && payload.startsWith("link_")) {
        const token = payload.replace("link_", "");
        const telegramService = getTelegramService();
        const walletAddress = telegramService.validateToken(token);
        
        this.log(`Validating token: ${token} -> Wallet: ${walletAddress}`);

        if (walletAddress) {
          try {
            const chatId = ctx.chat?.id.toString();
            const telegramUsername = ctx.from?.username || "User";

            if (!chatId) {
              await ctx.reply("❌ Error: Could not determine chat ID.");
              return;
            }

            // Link the user in Walrus
            const blobId = await this.ticketMinter.getCurrentBlobId();
            if (blobId) {
              const profile = await this.userManager.getUserProfile(blobId, walletAddress);
              if (profile) {
                const updatedProfile = this.userManager.createUserProfile(
                  profile.email,
                  profile.wallet_address,
                  profile.is_waitlisted,
                  profile.points_awarded,
                  {
                    ...profile,
                    telegram_chat_id: chatId,
                    telegram_username: telegramUsername,
                  }
                );

                const newBlobId = await this.userManager.addOrUpdateUser(blobId, updatedProfile);
                if (newBlobId && newBlobId !== blobId) {
                  await this.ticketMinter.updateBlobRegistry(newBlobId);
                }

                telegramService.consumeToken(token);
                await ctx.reply(`✅ Successfully linked to Tovira Dashboard!\nWallet: ${walletAddress.substring(0, 6)}...${walletAddress.slice(-4)}\nNotifications are now enabled.`);
                return;
              }
            }
            await ctx.reply("❌ Error: User profile not found. Please ensure you are logged in on the web app.");
          } catch (error) {
            console.error("Error in Telegram link handler:", error);
            await ctx.reply("❌ Linking failed. Please try again later.");
          }
        } else {
          await ctx.reply("❌ Invalid or expired linking token. Please go back to the web app and try again.");
        }
      } else {
        // Handle standard /start without payload
        // Check if user is already linked
        try {
          const chatId = ctx.chat?.id.toString();
          if (chatId) {
            const blobId = await this.ticketMinter.getCurrentBlobId();
            if (blobId) {
              const walletAddress = await this.userManager.findWalletByTelegramChatId(blobId, chatId);
              if (walletAddress) {
                const profile = await this.userManager.getUserProfile(blobId, walletAddress);
                if (profile) {
                   await ctx.reply(`✅ You are already connected!\n\nUser: ${profile.telegram_username || "Unknown"}\nWallet: ${walletAddress.substring(0, 6)}...${walletAddress.slice(-4)}\n\nUse /info to see more details.`);
                   return;
                }
              }
            }
          }
        } catch (err) {
            this.log("Error checking existing link status:", err);
        }

        await ctx.reply("Welcome to Tovira! Link your wallet in the web app to receive notifications here.");
      }
    });

    this.bot.command("info", async (ctx) => {
      try {
        const chatId = ctx.chat?.id.toString();
        if (!chatId) return;

        const blobId = await this.ticketMinter.getCurrentBlobId();
        if (!blobId) {
          await ctx.reply("❌ Service temporarily unavailable (Registry not found).");
          return;
        }

        const walletAddress = await this.userManager.findWalletByTelegramChatId(blobId, chatId);
        if (!walletAddress) {
          await ctx.reply("❌ You are not connected. Please go to the dashboard to link your account.");
          return;
        }

        const profile = await this.userManager.getUserProfile(blobId, walletAddress);
        if (!profile) {
           await ctx.reply("❌ User profile not found.");
           return;
        }

        const subscription = profile.subscription_tier === 1 ? "Premium" : "Free";
        const message = `
📊 *Your Tovira Profile*

👤 *User:* ${profile.telegram_username || "Unknown"}
👛 *Wallet:* \`${walletAddress}\`
💎 *Plan:* ${subscription}
🔥 *Streak:* ${profile.current_streak || 0} days

_Use /disconnect in the web app to unlink._
        `.trim();

        await ctx.replyWithMarkdown(message);

      } catch (error) {
        this.log("Error in /info command:", error);
        await ctx.reply("❌ Failed to fetch info.");
      }
    });

    this.bot.command("status", async (ctx) => {
      await ctx.reply("You are connected to Tovira.");
    });

    this.bot.command("tasks", async (ctx) => {
      try {
        const chatId = ctx.chat?.id.toString();
        if (!chatId) return;

        const blobId = await this.ticketMinter.getCurrentBlobId();
        if (!blobId) {
          await ctx.reply("❌ Service unavailable.");
          return;
        }

        const walletAddress = await this.userManager.findWalletByTelegramChatId(blobId, chatId);
        this.log(`Tasks command: ChatID ${chatId} -> Wallet ${walletAddress}`);
        
        if (!walletAddress) {
          await ctx.reply("❌ You are not connected. Link your account in the dashboard.");
          return;
        }

        // Import here to avoid circular dependencies if any
        const { getTaskStorageService } = await import("./taskStorageService");
        const taskStorage = getTaskStorageService();
        const tasks = await taskStorage.getTasks(walletAddress);

        const total = tasks.length;
        const pending = tasks.filter(t => t.status === "pending").length;
        const completed = tasks.filter(t => t.status === "completed").length;
        const overdue = tasks.filter(t => t.status === "pending" && t.due_date && new Date(t.due_date) < new Date()).length;

        const message = `
📋 *Your Tasks*

Total: ${total}
🟡 Pending: ${pending}
🟢 Completed: ${completed}
🔴 Overdue: ${overdue}

_Detailed list is available on the dashboard._
        `.trim();

        await ctx.replyWithMarkdown(message);

      } catch (error) {
        this.log("Error in /tasks command:", error);
        await ctx.reply("❌ Failed to fetch tasks.");
      }
    });
  }

  public async sendMessage(chatId: string, message: string) {
    if (!this.bot) return;
    try {
      await this.bot.telegram.sendMessage(chatId, message);
    } catch (error) {
      console.error(`Failed to send Telegram message to ${chatId}:`, error);
    }
  }
}

export const getTelegramBot = () => TelegramBot.getInstance();