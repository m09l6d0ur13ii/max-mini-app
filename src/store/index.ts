import fs from 'fs';
import path from 'path';
import { MessageRecord, ReactionEntry, BridgeStats } from './types';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');

export class BridgeStore {
  private messages: MessageRecord[] = [];
  private tgIndex = new Map<string, MessageRecord>();
  private maxIndex = new Map<string, MessageRecord>();
  private idIndex = new Map<string, MessageRecord>();

  private stats: BridgeStats = {
    totalMessagesSynced: 0,
    fromTelegramCount: 0,
    fromMaxCount: 0,
    reactionsSyncedCount: 0,
    startedAt: Date.now(),
  };

  private flushTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.ensureDataDir();
    this.load();
  }

  private ensureDataDir(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private load(): void {
    try {
      if (fs.existsSync(MESSAGES_FILE)) {
        const raw = fs.readFileSync(MESSAGES_FILE, 'utf-8');
        const list: MessageRecord[] = JSON.parse(raw);
        for (const item of list) {
          this.indexRecord(item);
        }
      }
      if (fs.existsSync(STATS_FILE)) {
        const rawStats = fs.readFileSync(STATS_FILE, 'utf-8');
        const loadedStats: BridgeStats = JSON.parse(rawStats);
        this.stats = { ...this.stats, ...loadedStats };
      }
    } catch (err) {
      console.error('[Store] Failed to load data from disk, initializing fresh store:', err);
    }
  }

  private indexRecord(record: MessageRecord): void {
    this.messages.push(record);
    this.idIndex.set(record.id, record);
    if (record.tgChatId && record.tgMessageId) {
      this.tgIndex.set(`${record.tgChatId}:${record.tgMessageId}`, record);
    }
    if (record.maxChatId && record.maxMid) {
      this.maxIndex.set(`${record.maxChatId}:${record.maxMid}`, record);
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimeout) return;
    this.flushTimeout = setTimeout(() => {
      this.flushTimeout = null;
      this.flush();
    }, 1000);
  }

  public flush(): void {
    try {
      this.ensureDataDir();
      const tmpMessages = `${MESSAGES_FILE}.tmp`;
      const tmpStats = `${STATS_FILE}.tmp`;

      // Keep only last 5000 messages in persistent storage to prevent unbounded growth
      const toPersist = this.messages.slice(-5000);
      fs.writeFileSync(tmpMessages, JSON.stringify(toPersist, null, 2), 'utf-8');
      fs.renameSync(tmpMessages, MESSAGES_FILE);

      fs.writeFileSync(tmpStats, JSON.stringify(this.stats, null, 2), 'utf-8');
      fs.renameSync(tmpStats, STATS_FILE);
    } catch (err) {
      console.error('[Store] Error flushing to disk:', err);
    }
  }

  public saveMessage(record: MessageRecord): void {
    this.indexRecord(record);
    this.stats.totalMessagesSynced++;
    if (record.source === 'telegram') {
      this.stats.fromTelegramCount++;
    } else if (record.source === 'max') {
      this.stats.fromMaxCount++;
    }
    this.scheduleFlush();
  }

  public updateRecord(record: MessageRecord): void {
    this.scheduleFlush();
  }

  public updateMapping(
    recordId: string,
    updates: { tgChatId?: number; tgMessageId?: number; maxChatId?: number; maxMid?: string }
  ): void {
    const record = this.idIndex.get(recordId);
    if (!record) return;

    if (updates.tgChatId && updates.tgMessageId) {
      record.tgChatId = updates.tgChatId;
      record.tgMessageId = updates.tgMessageId;
      this.tgIndex.set(`${updates.tgChatId}:${updates.tgMessageId}`, record);
    }
    if (updates.maxChatId && updates.maxMid) {
      record.maxChatId = updates.maxChatId;
      record.maxMid = updates.maxMid;
      this.maxIndex.set(`${updates.maxChatId}:${updates.maxMid}`, record);
    }
    this.scheduleFlush();
  }

  public findByTg(chatId: number, messageId: number): MessageRecord | undefined {
    return this.tgIndex.get(`${chatId}:${messageId}`);
  }

  public findByMax(chatId: number, mid: string): MessageRecord | undefined {
    return this.maxIndex.get(`${chatId}:${mid}`);
  }

  public findById(id: string): MessageRecord | undefined {
    return this.idIndex.get(id);
  }

  public deleteMessage(id: string): void {
    const record = this.idIndex.get(id);
    if (!record) return;
    this.idIndex.delete(id);
    if (record.tgChatId && record.tgMessageId) {
      this.tgIndex.delete(`${record.tgChatId}:${record.tgMessageId}`);
    }
    if (record.maxChatId && record.maxMid) {
      this.maxIndex.delete(`${record.maxChatId}:${record.maxMid}`);
    }
    this.messages = this.messages.filter((m) => m.id !== id);
    this.scheduleFlush();
  }

  public addReaction(
    record: MessageRecord,
    emoji: string,
    user: string,
    source: 'telegram' | 'max' | 'webapp'
  ): boolean {
    if (!record.reactions) {
      record.reactions = [];
    }
    let existing = record.reactions.find((r) => r.emoji === emoji);
    if (!existing) {
      existing = {
        emoji,
        users: [user],
        source,
        updatedAt: Date.now(),
      };
      record.reactions.push(existing);
      this.stats.reactionsSyncedCount++;
      this.scheduleFlush();
      return true;
    } else if (!existing.users.includes(user)) {
      existing.users.push(user);
      existing.updatedAt = Date.now();
      this.stats.reactionsSyncedCount++;
      this.scheduleFlush();
      return true;
    }
    return false;
  }

  public removeReaction(record: MessageRecord, emoji: string, user: string): boolean {
    if (!record.reactions) return false;
    const existing = record.reactions.find((r) => r.emoji === emoji);
    if (existing) {
      const idx = existing.users.indexOf(user);
      if (idx !== -1) {
        existing.users.splice(idx, 1);
        if (existing.users.length === 0) {
          record.reactions = record.reactions.filter((r) => r.emoji !== emoji);
        }
        this.scheduleFlush();
        return true;
      }
    }
    return false;
  }

  public getRecentMessages(limit: number = 50): MessageRecord[] {
    return this.messages.slice(-limit).reverse();
  }

  public getStats(): BridgeStats {
    return { ...this.stats };
  }
}

export const store = new BridgeStore();
