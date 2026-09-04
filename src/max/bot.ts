import { Bot as MaxBot } from '@maxhub/max-bot-api';
import { config } from '../config';
import { bridge } from '../bridge/manager';
import { store } from '../store';

const EMOJI_REGEX = /^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\u200d)+$/u;

export function createMaxBot(): MaxBot {
  const bot = new MaxBot(config.max.token);

  bot.catch((err, ctx) => {
    console.error('[MAX Bot] Unhandled error in update:', err);
  });

  // Handle incoming messages
  bot.on('message_created', async (ctx) => {
    try {
      const msg = ctx.message;
      if (!msg) return;

      const sender = msg.sender || ctx.user;
      const senderId = sender?.user_id;
      const isBot = sender?.is_bot || false;

      // Extract sender name
      const senderName = [sender?.first_name, sender?.last_name].filter(Boolean).join(' ') || 'Пользователь MAX';
      const senderUsername = sender?.username || undefined;

      const chatId = ctx.chatId || msg.recipient?.chat_id;
      if (!chatId) return;

      const text = msg.body?.text || '';
      console.log(`[MAX] 📩 Получено сообщение от ${senderName} в чате ${chatId}: "${text}"`);
      const replyToMid = msg.link?.message?.mid;

      // Check if this message is an emoji reaction to a replied message
      const trimmedText = text.trim();
      const isEmojiReply = replyToMid && (EMOJI_REGEX.test(trimmedText) || trimmedText.startsWith('/react '));
      if (isEmojiReply) {
        const emoji = trimmedText.startsWith('/react ') ? trimmedText.replace('/react ', '').trim() : trimmedText;
        console.log(`[MAX] User ${senderName} replied with reaction: ${emoji} to message ${replyToMid}`);
        await bridge.syncMaxReaction({
          chatId,
          mid: replyToMid,
          user: senderName,
          emoji,
          action: 'add',
        });
        // We still let users know or return without re-broadcasting the emoji as a raw message
        return;
      }

      // Check for attachments (photos, videos, files)
      let hasMedia = false;
      let mediaType: 'photo' | 'video' | 'audio' | 'voice' | 'document' | 'sticker' | 'other' | undefined;
      let mediaUrl: string | undefined;

      if (msg.body?.attachments && msg.body.attachments.length > 0) {
        const att = msg.body.attachments[0];
        hasMedia = true;
        if (att.type === 'image') {
          mediaType = 'photo';
          mediaUrl = (att as any).payload?.url || undefined;
        } else if (att.type === 'video') {
          mediaType = 'video';
          mediaUrl = (att as any).payload?.url || undefined;
        } else if (att.type === 'audio') {
          mediaType = 'audio';
          mediaUrl = (att as any).payload?.url || undefined;
        } else if (att.type === 'file') {
          mediaType = 'document';
          mediaUrl = (att as any).payload?.url || undefined;
        } else if (att.type === 'sticker') {
          mediaType = 'sticker';
          mediaUrl = (att as any).payload?.url || undefined;
        }
      }

      await bridge.forwardMaxToTelegram({
        chatId,
        mid: msg.body?.mid || ctx.messageId || '',
        senderId,
        senderName,
        senderUsername,
        isBot,
        text,
        replyToMid,
        hasMedia,
        mediaType,
        mediaUrl,
      });
    } catch (err) {
      console.error('[MAX] Error processing message_created:', err);
    }
  });

  // Handle comments (can be used as reactions under messages in MAX)
  bot.on('comment_created', async (ctx) => {
    try {
      const comment = (ctx.update as any)?.comment;
      const mid = (ctx.update as any)?.message_id;
      const chatId = ctx.chatId;

      if (comment && mid && chatId) {
        const text = (comment.body?.text || '').trim();
        const sender = comment.sender;
        const senderName = [sender?.first_name, sender?.last_name].filter(Boolean).join(' ') || 'Пользователь MAX';

        if (EMOJI_REGEX.test(text)) {
          console.log(`[MAX] Emoji comment detected as reaction: ${text} on message ${mid}`);
          await bridge.syncMaxReaction({
            chatId,
            mid,
            user: senderName,
            emoji: text,
            action: 'add',
          });
        }
      }
    } catch (err) {
      console.error('[MAX] Error processing comment_created:', err);
    }
  });

  // Handle 1-click reaction buttons under messages in MAX
  bot.on('message_callback', async (ctx) => {
    try {
      const cb = ctx.callback;
      if (!cb) return;

      const payload = cb.payload || '';
      if (payload === 'done') {
        try {
          await ctx.answerOnCallback({});
        } catch (e) {}
        return;
      }

      // Worker clicks "Отменить выполнение" -> cancel order, clear TG reaction, restore reaction buttons in MAX!
      if (payload === 'unreact') {
        const mid = ctx.messageId || ctx.message?.body.mid;
        const chatId = ctx.chatId || ctx.message?.recipient.chat_id;
        const sender = cb.user || ctx.user;
        const senderName = [sender?.first_name, sender?.last_name].filter(Boolean).join(' ') || 'Сотрудник';

        console.log(`[MAX] 🔄 Отмена выполнения заказа на сообщении ${mid} пользователем ${senderName}`);

        if (mid && chatId) {
          const record = store.findByMax(chatId, mid);
          if (record) {
            // Clear reaction in Telegram
            if (record.tgChatId && record.tgMessageId) {
              try {
                await bridge.callTelegramApi('setMessageReaction', {
                  chat_id: record.tgChatId,
                  message_id: record.tgMessageId,
                  reaction: [],
                });
                console.log(`[Bridge] Reaction cleared in TG for message #${record.tgMessageId}`);
              } catch (tgErr) {
                console.warn('[Bridge] Could not clear TG reaction:', tgErr);
              }
            }

            // Restore clean text and reaction buttons in MAX
            record.reactions = [];
            store.updateRecord(record);

            const author = record.authorName || 'Заказ';
            const baseText = `${author}:\n${record.text || ''}`;
            const reactionButtons = [
              { type: 'callback' as const, text: '👍', payload: 'react:👍' },
              { type: 'callback' as const, text: '🔥', payload: 'react:🔥' },
              { type: 'callback' as const, text: '❤️', payload: 'react:❤️' },
              { type: 'callback' as const, text: '👏', payload: 'react:👏' },
              { type: 'callback' as const, text: '👎', payload: 'react:👎' },
            ];

            try {
              await bot.api.editMessage(mid, {
                text: baseText,
                attachments: [
                  {
                    type: 'inline_keyboard',
                    payload: {
                      buttons: [reactionButtons],
                    },
                  },
                ],
              });
              console.log(`[MAX] Order #${mid} returned to work, buttons restored`);
            } catch (editErr) {
              console.warn('[MAX] Could not restore buttons:', editErr);
            }
          }
        }

        try {
          await ctx.answerOnCallback({});
        } catch (e) {}
        return;
      }

      if (payload.startsWith('react:')) {
        const emoji = payload.replace('react:', '').trim();
        const mid = ctx.messageId || ctx.message?.body.mid;
        const chatId = ctx.chatId || ctx.message?.recipient.chat_id;
        const sender = cb.user || ctx.user;
        const senderName = [sender?.first_name, sender?.last_name].filter(Boolean).join(' ') || 'Пользователь MAX';

        console.log(`[MAX] 🔘 Нажата кнопка реакции ${emoji} на сообщении ${mid} пользователем ${senderName}`);

        if (mid && chatId) {
          await bridge.syncMaxReaction({
            chatId,
            mid,
            user: senderName,
            emoji,
            action: 'add',
          });

          // Visually update the message in MAX to show order is taken/collected and replace buttons
          const record = store.findByMax(chatId, mid);
          if (record) {
            const author = record.authorName || 'Заказ';
            const baseText = `${author}:\n${record.text || ''}`;
            const updatedText = `${baseText}\n\n✅ Заказ собран (${emoji} ${senderName})`;

            try {
              await bot.api.editMessage(mid, {
                text: updatedText,
                attachments: [
                  {
                    type: 'inline_keyboard',
                    payload: {
                      buttons: [
                        [{ type: 'callback', text: `✅ Заказ закрыт (${emoji})`, payload: 'done' }],
                        [{ type: 'callback', text: `❌ Отменить выполнение`, payload: 'unreact' }],
                      ],
                    },
                  },
                ],
              });
              console.log(`[MAX] Order marked as collected on message #${mid}`);
            } catch (editErr) {
              console.warn('[MAX] Could not edit message after button click:', editErr);
            }
          }
        }

        // Answer callback
        try {
          await ctx.answerOnCallback({});
        } catch (e) {}
      }
    } catch (err) {
      console.error('[MAX] Error processing message_callback:', err);
    }
  });

  // Handle message deletion in MAX -> delete corresponding message in Telegram
  bot.on('message_removed', async (ctx) => {
    try {
      const mid = (ctx.update as any)?.message_id;
      if (mid) {
        console.log(`[MAX] 🗑 Сообщение удалено в MAX: ${mid}`);
        await bridge.deleteSyncedMessage({ source: 'max', id: mid });
      }
    } catch (err) {
      console.error('[MAX] Error processing message_removed:', err);
    }
  });

  return bot;
}
