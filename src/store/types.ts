export interface ReactionEntry {
  emoji: string;
  users: string[];
  source: 'telegram' | 'max' | 'webapp';
  updatedAt: number;
}

export interface MessageRecord {
  id: string;
  source: 'telegram' | 'max' | 'webapp';
  tgChatId?: number;
  tgMessageId?: number;
  maxChatId?: number;
  maxMid?: string;
  authorName: string;
  authorUsername?: string;
  text: string;
  hasMedia: boolean;
  mediaType?: 'photo' | 'video' | 'audio' | 'voice' | 'document' | 'sticker' | 'other';
  mediaUrl?: string;
  createdAt: number;
  reactions: ReactionEntry[];
}

export interface BridgeStats {
  totalMessagesSynced: number;
  fromTelegramCount: number;
  fromMaxCount: number;
  reactionsSyncedCount: number;
  startedAt: number;
}
