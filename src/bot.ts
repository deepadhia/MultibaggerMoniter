import { Telegraf } from 'telegraf';

const BOT_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN) {
  console.warn('TELEGRAM_TOKEN is not set.');
}

export const bot = BOT_TOKEN ? new Telegraf(BOT_TOKEN) : null;

export const sendTelegramAlert = async (message: string) => {
  if (!bot || !CHAT_ID) {
    console.error('Cannot send Telegram alert: BOT_TOKEN or CHAT_ID is missing');
    return;
  }
  
  try {
    await bot.telegram.sendMessage(CHAT_ID, message, { parse_mode: 'Markdown' });
    console.log('Telegram alert sent successfully');
  } catch (error) {
    console.error('Error sending Telegram alert:', error);
  }
};
