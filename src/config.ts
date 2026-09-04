import dotenv from 'dotenv';
dotenv.config();

export interface AppConfig {
  telegram: {
    token: string;
    chatId: number;
  };
  max: {
    token: string;
    chatId: number;
  };
  server: {
    port: number;
    webAppUrl: string;
    syncReactions: boolean;
    debug: boolean;
  };
}

export const config: AppConfig = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: parseInt(process.env.TELEGRAM_CHAT_ID || '0', 10),
  },
  max: {
    token: process.env.MAX_BOT_TOKEN || '',
    chatId: parseInt(process.env.MAX_CHAT_ID || '0', 10),
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    webAppUrl: process.env.WEBAPP_URL || 'http://localhost:3000',
    syncReactions: process.env.SYNC_REACTIONS !== 'false',
    debug: process.env.DEBUG === 'true',
  },
};

export function validateConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!config.telegram.token) {
    errors.push('TELEGRAM_BOT_TOKEN is not defined in .env');
  }
  if (!config.telegram.chatId) {
    errors.push('TELEGRAM_CHAT_ID is not defined or is 0 in .env');
  }
  if (!config.max.token) {
    errors.push('MAX_BOT_TOKEN is not defined in .env');
  }
  if (!config.max.chatId) {
    errors.push('MAX_CHAT_ID is not defined or is 0 in .env');
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}
