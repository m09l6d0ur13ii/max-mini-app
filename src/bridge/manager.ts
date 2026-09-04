import { Bot as TgBot } from 'grammy';
import { Bot as MaxBot } from '@maxhub/max-bot-api';
import { config } from '../config';
import { store } from '../store';
import { MessageRecord } from '../store/types';
import crypto from 'crypto';

export class BridgeManager {
  private tgBot: TgBot | null = null;
  private maxBot: MaxBot | null = null;
  private maxBotId: number | null = null;

  public setTelegramBot(bot: TgBot): void {
    this.tgBot = bot;
  }

  public setMaxBot(bot: MaxBot, botId?: number): void {
    this.maxBot = bot;
    if (botId) this.maxBotId = botId;
  }

  public async initMaxBotInfo(): Promise<void> {
    if (this.maxBot) {
      try {
        const info = await this.maxBot.api.getMyInfo();
        if (info && info.user_id) {
          this.maxBotId = info.user_id;
          console.log(`[Bridge] MAX Bot verified: ${info.name || 'Bot'} (ID: ${this.maxBotId})`);
        }
      } catch (err) {
        console.warn('[Bridge] Could not fetch MAX bot info upfront:', err);
      }
    }
  }

  /**
   * Forwards a message from Telegram to MAX
   */
  public async forwardTelegramToMax(params: {
    chatId: number;
    messageId: number;
    senderName: string;
    senderUsername?: string;
    text: string;
    replyToMessageId?: number;
    hasMedia?: boolean;
    mediaType?: MessageRecord['mediaType'];
    mediaUrl?: string;
  }): Promise<void> {
    if (!this.maxBot) {
      console.warn('[Bridge] MAX Bot not ready yet');
      return;
    }

    // Only forward messages from the configured Telegram chat
    if (params.chatId !== config.telegram.chatId) {
      if (config.server.debug) {
        console.log(`[Bridge] Ignored TG message from chat ${params.chatId} (expected ${config.telegram.chatId})`);
      }
      return;
    }

    try {
      const recordId = crypto.randomUUID();
      const author = params.senderName || 'Заказ';
      let maxText = `${author}:\n${params.text || (params.hasMedia ? `[Вложение: ${params.mediaType}]` : '')}`;

      // Check if this is a reply to a known bridged message
      let replyMid: string | undefined;
      if (params.replyToMessageId) {
        const parentRecord = store.findByTg(params.chatId, params.replyToMessageId);
        if (parentRecord && parentRecord.maxMid) {
          replyMid = parentRecord.maxMid;
        }
      }

      // Build options for MAX API
      const options: any = {};
      if (replyMid) {
        options.link = {
          type: 'reply',
          mid: replyMid,
        };
      }

      if (params.hasMedia && params.mediaUrl && params.mediaType === 'photo') {
        options.attachments = [
          {
            type: 'image',
            payload: {
              url: params.mediaUrl,
            },
          },
        ];
      }

      // Add interactive reaction buttons directly under the message in MAX
      const reactionButtons = [
        { type: 'callback', text: '👍', payload: 'react:👍' },
        { type: 'callback', text: '🔥', payload: 'react:🔥' },
        { type: 'callback', text: '❤️', payload: 'react:❤️' },
        { type: 'callback', text: '👏', payload: 'react:👏' },
        { type: 'callback', text: '👎', payload: 'react:👎' },
      ];
      options.attachments = options.attachments || [];
      options.attachments.push({
        type: 'inline_keyboard',
        payload: {
          buttons: [reactionButtons],
        },
      });

      // Send to MAX chat
      const maxMsg = await this.maxBot.api.sendMessageToChat(config.max.chatId, maxText, options);
      const maxMid = maxMsg.body.mid;

      // Save to store
      const record: MessageRecord = {
        id: recordId,
        source: 'telegram',
        tgChatId: params.chatId,
        tgMessageId: params.messageId,
        maxChatId: config.max.chatId,
        maxMid: maxMid,
        authorName: params.senderName,
        authorUsername: params.senderUsername,
        text: params.text,
        hasMedia: !!params.hasMedia,
        mediaType: params.mediaType,
        mediaUrl: params.mediaUrl,
        createdAt: Date.now(),
        reactions: [],
      };

      store.saveMessage(record);
      console.log(`[Bridge] TG -> MAX synced: TG#${params.messageId} -> MAX#${maxMid}`);
    } catch (err) {
      console.error('[Bridge] Failed to forward TG message to MAX:', err);
    }
  }

  /**
   * Forwards a message from MAX to Telegram
   */
  public async forwardMaxToTelegram(params: {
    chatId: number;
    mid: string;
    senderId?: number;
    senderName: string;
    senderUsername?: string;
    isBot?: boolean;
    text: string;
    replyToMid?: string;
    hasMedia?: boolean;
    mediaType?: MessageRecord['mediaType'];
    mediaUrl?: string;
  }): Promise<void> {
    if (!this.tgBot) {
      console.warn('[Bridge] Telegram Bot not ready yet');
      return;
    }

    // Ignore bot's own messages to prevent looping
    if (params.isBot || (this.maxBotId && params.senderId === this.maxBotId)) {
      return;
    }

    // Only forward messages from the configured MAX chat
    if (config.max.chatId && String(params.chatId) !== String(config.max.chatId)) {
      console.log(`[Bridge] Ignored MAX message from chat ${params.chatId} (configured for ${config.max.chatId})`);
      return;
    }

    try {
      const recordId = crypto.randomUUID();
      const author = params.senderName || 'Склад';
      const safeText = escapeHtml(params.text || (params.hasMedia ? `[Вложение: ${params.mediaType}]` : ''));
      const tgText = `<b>${escapeHtml(author)}:</b>\n${safeText}`;

      // Check if this is a reply to a known bridged message
      let replyTgId: number | undefined;
      if (params.replyToMid) {
        const parentRecord = store.findByMax(params.chatId, params.replyToMid);
        if (parentRecord && parentRecord.tgMessageId) {
          replyTgId = parentRecord.tgMessageId;
        }
      }

      const sendOptions: any = {
        parse_mode: 'HTML',
      };
      if (replyTgId) {
        sendOptions.reply_parameters = {
          message_id: replyTgId,
        };
      }

      let tgMsg;
      if (params.hasMedia && params.mediaUrl && params.mediaType === 'photo') {
        tgMsg = await this.tgBot.api.sendPhoto(config.telegram.chatId, params.mediaUrl, {
          caption: tgText,
          parse_mode: 'HTML',
          reply_parameters: replyTgId ? { message_id: replyTgId } : undefined,
        });
      } else {
        tgMsg = await this.tgBot.api.sendMessage(config.telegram.chatId, tgText, sendOptions);
      }

      const tgMessageId = tgMsg.message_id;

      // Save to store
      const record: MessageRecord = {
        id: recordId,
        source: 'max',
        tgChatId: config.telegram.chatId,
        tgMessageId: tgMessageId,
        maxChatId: params.chatId,
        maxMid: params.mid,
        authorName: params.senderName,
        authorUsername: params.senderUsername,
        text: params.text,
        hasMedia: !!params.hasMedia,
        mediaType: params.mediaType,
        mediaUrl: params.mediaUrl,
        createdAt: Date.now(),
        reactions: [],
      };

      store.saveMessage(record);
      console.log(`[Bridge] MAX -> TG synced: MAX#${params.mid} -> TG#${tgMessageId}`);
    } catch (err: any) {
      if (err.parameters?.migrate_to_chat_id) {
        const newChatId = err.parameters.migrate_to_chat_id;
        console.log(`[Bridge] 🔄 Telegram группа обновилась до супергруппы: ${newChatId}. Повторяем отправку...`);
        config.telegram.chatId = newChatId;
        try {
          const retryMsg = await this.tgBot.api.sendMessage(newChatId, `<b>[MAX] 👤 ${escapeHtml(params.senderUsername ? `${params.senderName} (@${params.senderUsername})` : params.senderName)}:</b>\n${escapeHtml(params.text || '')}`, { parse_mode: 'HTML' });
          console.log(`[Bridge] MAX -> TG повторно успешно отправлено: TG#${retryMsg.message_id}`);
        } catch (retryErr) {
          console.error('[Bridge] Ошибка при повторной отправке в новую супергруппу:', retryErr);
        }
      } else {
        console.error('[Bridge] Failed to forward MAX message to Telegram:', err);
      }
    }
  }

  /**
   * Syncs a reaction placed in Telegram to MAX
   */
  public async syncTelegramReaction(params: {
    chatId: number;
    messageId: number;
    user: string;
    newReactions: string[];
    oldReactions: string[];
  }): Promise<void> {
    if (!config.server.syncReactions) return;

    const record = store.findByTg(params.chatId, params.messageId);
    if (!record) {
      if (config.server.debug) {
        console.log(`[Bridge] Reaction on unmapped TG message #${params.messageId}`);
      }
      return;
    }

    // Find added and removed reactions
    const added = params.newReactions.filter((e) => !params.oldReactions.includes(e));
    const removed = params.oldReactions.filter((e) => !params.newReactions.includes(e));

    for (const emoji of added) {
      store.addReaction(record, emoji, params.user, 'telegram');
      console.log(`[Bridge] Reaction added in TG on message ${record.id}: ${emoji} by ${params.user}`);
    }

    for (const emoji of removed) {
      store.removeReaction(record, emoji, params.user);
      console.log(`[Bridge] Reaction removed in TG on message ${record.id}: ${emoji} by ${params.user}`);
    }

    // Update MAX message: append clean status and replace buttons with closed badge
    if (this.maxBot && record.maxMid && record.source === 'telegram') {
      try {
        const author = record.authorName || 'Заказ';
        const baseText = `${author}:\n${record.text || ''}`;
        const reactionBadges = (record.reactions || [])
          .map((r) => `${r.emoji}`)
          .join(' ');

        let updatedText = baseText;
        let buttonsAttachment: any[] = [];

        if (reactionBadges) {
          updatedText = `${baseText}\n\n✅ Заказ собран (${reactionBadges} ${params.user})`;
          buttonsAttachment = [
            {
              type: 'inline_keyboard',
              payload: {
                buttons: [[{ type: 'callback', text: `✅ Заказ закрыт (${reactionBadges})`, payload: 'done' }]],
              },
            },
          ];
        }

        await this.maxBot.api.editMessage(record.maxMid, {
          text: updatedText,
          attachments: buttonsAttachment,
        });
        console.log(`[Bridge] Updated MAX message #${record.maxMid} with closed status`);
      } catch (editErr) {
        if (config.server.debug) {
          console.warn('[Bridge] Could not edit MAX message with reactions:', editErr);
        }
      }
    }
  }

  /**
   * Syncs a reaction placed in MAX (via chat / reply / command / Mini-App) to Telegram
   */
  public async syncMaxReaction(params: {
    chatId: number;
    mid: string;
    user: string;
    emoji: string;
    action: 'add' | 'remove';
  }): Promise<void> {
    if (!config.server.syncReactions) return;

    const record = store.findByMax(params.chatId, params.mid);
    if (!record) {
      if (config.server.debug) {
        console.log(`[Bridge] Reaction on unmapped MAX message #${params.mid}`);
      }
      return;
    }

    if (params.action === 'add') {
      const changed = store.addReaction(record, params.emoji, params.user, 'max');
      if (changed && this.tgBot && record.tgChatId && record.tgMessageId) {
        try {
          await this.tgBot.api.setMessageReaction(record.tgChatId, record.tgMessageId, [
            { type: 'emoji', emoji: params.emoji as any },
          ]);
          console.log(`[Bridge] Mirrored MAX reaction ${params.emoji} to Telegram message #${record.tgMessageId}`);
        } catch (err) {
          console.error('[Bridge] Failed to set reaction in Telegram:', err);
        }
      }
    } else {
      const changed = store.removeReaction(record, params.emoji, params.user);
      if (changed && this.tgBot && record.tgChatId && record.tgMessageId) {
        try {
          // If there are remaining reactions, set the first one, else clear
          const remaining = record.reactions?.[0]?.emoji;
          if (remaining) {
            await this.tgBot.api.setMessageReaction(record.tgChatId, record.tgMessageId, [
              { type: 'emoji', emoji: remaining as any },
            ]);
          } else {
            await this.tgBot.api.setMessageReaction(record.tgChatId, record.tgMessageId, []);
          }
          console.log(`[Bridge] Cleared/updated reaction in Telegram message #${record.tgMessageId}`);
        } catch (err) {
          console.error('[Bridge] Failed to clear reaction in Telegram:', err);
        }
      }
    }
  }

  /**
   * Syncs a reaction triggered directly from the MAX WebApp Mini-App
   */
  public async syncWebAppReaction(recordId: string, emoji: string, user: string): Promise<MessageRecord | null> {
    const record = store.findById(recordId);
    if (!record) return null;

    // Check if user already reacted with this emoji (toggle)
    const existing = record.reactions?.find((r) => r.emoji === emoji && r.users.includes(user));
    const action = existing ? 'remove' : 'add';

    if (action === 'add') {
      store.addReaction(record, emoji, user, 'webapp');
      // Mirror to Telegram
      if (this.tgBot && record.tgChatId && record.tgMessageId) {
        try {
          await this.tgBot.api.setMessageReaction(record.tgChatId, record.tgMessageId, [
            { type: 'emoji', emoji: emoji as any },
          ]);
        } catch (err) {
          console.warn('[Bridge] WebApp reaction to TG error:', err);
        }
      }
      // Mirror to MAX comment if possible
      if (this.maxBot && record.maxMid) {
        try {
          await this.maxBot.api.sendComment(record.maxMid, `👤 ${user} поставил реакцию: ${emoji}`, {});
        } catch (err) {
          // Silent fallback
        }
      }
    } else {
      store.removeReaction(record, emoji, user);
      if (this.tgBot && record.tgChatId && record.tgMessageId) {
        try {
          const remaining = record.reactions?.[0]?.emoji;
          await this.tgBot.api.setMessageReaction(
            record.tgChatId,
            record.tgMessageId,
            remaining ? [{ type: 'emoji', emoji: remaining as any }] : []
          );
        } catch (err) {
          console.warn('[Bridge] WebApp reaction remove from TG error:', err);
        }
      }
    }

    return record;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export const bridge = new BridgeManager();
