import { Telegraf } from 'telegraf';
import 'dotenv/config';

async function test() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  console.log('Testing Telegram Bot...');
  console.log('Token exists:', !!token);
  if (token) console.log('Token prefix:', token.substring(0, 5));

  if (!token) {
    console.error('No token found!');
    return;
  }

  const bot = new Telegraf(token);
  
  try {
    console.log('Attemping to fetch getMe()...');
    const me = await bot.telegram.getMe();
    console.log('Bot info:', me);

    console.log('Attemping to deleteWebhook()...');
    await bot.telegram.deleteWebhook();
    console.log('Webhook deleted.');

    console.log('Starting polling...');
    await bot.launch({ 
        dropPendingUpdates: true,
        allowedUpdates: ['message', 'callback_query']
    });
    console.log('Bot launched successfully! Send a message to the bot now.');
    
    // Enable graceful stop
    process.once('SIGINT', () => { 
        console.log('Stopping...');
        bot.stop('SIGINT');
    });
    process.once('SIGTERM', () => {
        console.log('Stopping...');
        bot.stop('SIGTERM');
    });

  } catch (err: any) {
    console.error('Error:', err);
    if (err.response) {
        console.error('Description:', err.response.description);
    }
  }
}

test();
