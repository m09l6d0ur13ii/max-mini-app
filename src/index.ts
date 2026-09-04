import { config, validateConfig } from './config';
import { store } from './store';
import { bridge } from './bridge/manager';
import { createTelegramBot } from './telegram/bot';
import { createMaxBot } from './max/bot';
import { createWebAppServer } from './webapp/server';

async function main() {
  console.log('====================================================');
  console.log('       MAX ⇄ Telegram Bridge & WebApp Bridge        ');
  console.log('====================================================');

  const validation = validateConfig();

  // 1. Start WebApp Server
  const app = createWebAppServer();
  const server = app.listen(config.server.port, () => {
    console.log(`[WebApp] Server is running at http://localhost:${config.server.port}`);
    console.log(`[WebApp] MAX Mini-App available at: ${config.server.webAppUrl}`);
  });

  if (!validation.valid) {
    console.warn('\n⚠️ Configuration warnings:');
    validation.errors.forEach((err) => console.warn(`  - ${err}`));
    console.warn('\nPlease fill in the required tokens in .env to activate bots.');
    console.warn('The WebApp server remains accessible for testing and viewing docs.\n');
  }

  // 2. Start Telegram Bot
  if (config.telegram.token && config.telegram.chatId) {
    try {
      const tgBot = createTelegramBot();
      bridge.setTelegramBot(tgBot);

      // Start long polling for Telegram
      tgBot.start({
        drop_pending_updates: true,
        allowed_updates: ['message', 'edited_message', 'message_reaction', 'message_reaction_count'],
        onStart: (botInfo) => {
          console.log(`[Telegram] Bot started: @${botInfo.username} (ID: ${botInfo.id})`);
          console.log(`[Telegram] Bridging chat ID: ${config.telegram.chatId}`);
        },
      });
    } catch (err) {
      console.error('[Telegram] Failed to start Telegram bot:', err);
    }
  } else {
    console.log('[Telegram] Bot skipped (token or chatId not provided in .env)');
  }

  // 3. Start MAX Bot
  if (config.max.token && config.max.chatId) {
    try {
      const maxBot = createMaxBot();
      bridge.setMaxBot(maxBot);
      await bridge.initMaxBotInfo();

      // Start long polling for MAX
      maxBot
        .start({
          mode: 'polling',
          options: {
            retry: true,
          },
        })
        .catch((err) => {
          console.error('[MAX] Polling error:', err);
        });

      console.log(`[MAX] Bot polling started for chat ID: ${config.max.chatId}`);
    } catch (err) {
      console.error('[MAX] Failed to start MAX bot:', err);
    }
  } else {
    console.log('[MAX] Bot skipped (token or chatId not provided in .env)');
  }

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[App] Graceful shutdown initiated...');
    store.flush();
    server.close(() => {
      console.log('[WebApp] HTTP server closed.');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[App] Fatal error during startup:', err);
  process.exit(1);
});
