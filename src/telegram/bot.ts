import { Bot as TgBot } from 'grammy';
import { config } from '../config';
import { bridge } from '../bridge/manager';

export function createTelegramBot(): TgBot {
  const bot = new TgBot(config.telegram.token);

  // Error handling
  bot.catch((err) => {
    console.error('[Telegram Bot] Unhandled error:', err.error || err);
  });

  // Handle incoming messages
  bot.on('message', async (ctx) => {
    // Ignore messages from the bot itself
    if (ctx.from?.id === ctx.me.id) return;

    // Handle migration from group to supergroup
    if ((ctx.message as any)?.migrate_to_chat_id) {
      config.telegram.chatId = (ctx.message as any).migrate_to_chat_id;
      console.log(`[Telegram] 🔄 Группа переведена в супергруппу. Новый ID: ${config.telegram.chatId}`);
      return;
    }

    // Auto-detect or update Telegram group ID
    if (!config.telegram.chatId && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup')) {
      config.telegram.chatId = ctx.chat.id;
      console.log(`[Telegram] 🎯 Привязана группа: "${(ctx.chat as any).title || 'Группа'}" (ID: ${ctx.chat.id})`);
    } else if (ctx.chat.type === 'supergroup' && config.telegram.chatId && config.telegram.chatId !== ctx.chat.id && String(ctx.chat.id).startsWith('-100')) {
      config.telegram.chatId = ctx.chat.id;
      console.log(`[Telegram] 🔄 Обновлен ID супергруппы: ${config.telegram.chatId}`);
    }

    // Ignore messages from other chats if configured
    if (config.telegram.chatId && ctx.chat.id !== config.telegram.chatId) {
      if (config.server.debug) {
        console.log(`[Telegram] Ignored message from chat ${ctx.chat.id} (listening for ${config.telegram.chatId})`);
      }
      return;
    }

    const senderName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || 'Аноним';
    const senderUsername = ctx.from?.username;
    const text = (ctx.message.text || ctx.message.caption || '').trim();
    const replyToMessageId = ctx.message.reply_to_message?.message_id;

    // If user replies with /del or /delete or /отмена -> delete the message in both Telegram and MAX
    if (replyToMessageId && (text === '/del' || text === '/delete' || text.toLowerCase() === '/отмена' || text.toLowerCase() === 'отмена')) {
      console.log(`[Telegram] 🗑 Запрос на удаление сообщения TG#${replyToMessageId}`);
      try { await ctx.deleteMessage(); } catch (e) {}
      await bridge.deleteSyncedMessage({ source: 'telegram', id: replyToMessageId });
      return;
    }

    let hasMedia = false;
    let mediaType: 'photo' | 'video' | 'audio' | 'voice' | 'document' | 'sticker' | 'other' | undefined;
    let mediaUrl: string | undefined;

    try {
      if (ctx.message.photo && ctx.message.photo.length > 0) {
        hasMedia = true;
        mediaType = 'photo';
        const largest = ctx.message.photo[ctx.message.photo.length - 1];
        const file = await ctx.api.getFile(largest.file_id);
        if (file.file_path) {
          mediaUrl = `https://api.telegram.org/file/bot${config.telegram.token}/${file.file_path}`;
        }
      } else if (ctx.message.video) {
        hasMedia = true;
        mediaType = 'video';
      } else if (ctx.message.voice) {
        hasMedia = true;
        mediaType = 'voice';
      } else if (ctx.message.document) {
        hasMedia = true;
        mediaType = 'document';
      } else if (ctx.message.sticker) {
        hasMedia = true;
        mediaType = 'sticker';
      }

      await bridge.forwardTelegramToMax({
        chatId: ctx.chat.id,
        messageId: ctx.message.message_id,
        senderName,
        senderUsername,
        text,
        replyToMessageId,
        hasMedia,
        mediaType,
        mediaUrl,
      });
    } catch (err) {
      console.error('[Telegram] Error processing message:', err);
    }
  });

  // Handle message reactions (Telegram Bot API 7.0+)
  bot.on('message_reaction', async (ctx) => {
    try {
      const update = ctx.update.message_reaction;
      if (!update) return;

      if (!config.telegram.chatId && (update.chat.type === 'group' || update.chat.type === 'supergroup')) {
        config.telegram.chatId = update.chat.id;
        console.log(`[Telegram] 🎯 Привязана группа: ID ${update.chat.id}`);
      }

      if (config.telegram.chatId && update.chat.id !== config.telegram.chatId) return;

      const userName = update.user
        ? [update.user.first_name, update.user.last_name].filter(Boolean).join(' ')
        : 'Пользователь Telegram';

      const extractEmojis = (arr: any[]): string[] => {
        if (!Array.isArray(arr)) return [];
        return arr
          .filter((r) => r && r.type === 'emoji' && typeof r.emoji === 'string')
          .map((r) => r.emoji);
      };

      const newEmojis = extractEmojis(update.new_reaction);
      const oldEmojis = extractEmojis(update.old_reaction);

      await bridge.syncTelegramReaction({
        chatId: update.chat.id,
        messageId: update.message_id,
        user: userName,
        newReactions: newEmojis,
        oldReactions: oldEmojis,
      });
    } catch (err) {
      console.error('[Telegram] Error processing message_reaction:', err);
    }
  });

  return bot;
}
