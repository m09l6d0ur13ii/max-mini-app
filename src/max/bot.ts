import { Bot as MaxBot } from '@maxhub/max-bot-api';
import { config } from '../config';
import { bridge } from '../bridge/manager';

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

  return bot;
}
