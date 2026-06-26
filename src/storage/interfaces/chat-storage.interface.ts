export const CHAT_STORAGE = Symbol('CHAT_STORAGE');

/** One persisted tournament chat message. `seq` is server-authoritative
 *  ordering + gap-detection key. */
export interface ChatMessageRecord {
  seq: number;
  tournamentId: string;
  providerId?: string;
  providerAbbr?: string;
  tournamentName?: string;
  userName: string;
  message: string;
  clientMsgId?: string;
  isAdmin: boolean;
  createdAt: string; // ISO
}

export interface AppendChatMessageInput {
  tournamentId: string;
  providerId?: string;
  providerAbbr?: string;
  tournamentName?: string;
  userName: string;
  message: string;
  clientMsgId?: string;
  isAdmin?: boolean;
}

export interface IChatStorage {
  /** Insert one message; returns the persisted record with its assigned seq. */
  appendMessage(input: AppendChatMessageInput): Promise<{ record?: ChatMessageRecord; error?: string }>;

  /** Backfill on join: most-recent messages for a tournament within `sinceMs`
   *  (default 24h), capped by `limit`, returned in ascending seq order. */
  recentMessages(params: {
    tournamentId: string;
    sinceMs?: number;
    limit?: number;
  }): Promise<{ records?: ChatMessageRecord[]; error?: string }>;

  /** Gap fill: messages for a tournament with seq > afterSeq, ascending,
   *  capped by `limit`. */
  messagesSince(params: {
    tournamentId: string;
    afterSeq: number;
    limit?: number;
  }): Promise<{ records?: ChatMessageRecord[]; error?: string }>;

  /** Admin monitor page: most-recent messages across ALL tournaments, capped
   *  by `limit`, returned in ascending seq order. When `beforeSeq` is given,
   *  returns the page immediately older than it (for "load older"). No time
   *  window — the retention prune (CHAT_RETENTION_DAYS, default 30d) is the
   *  natural floor for how far back paging reaches. An empty result means the
   *  retention edge was reached. */
  adminMessagesBefore(params: {
    beforeSeq?: number;
    limit?: number;
  }): Promise<{ records?: ChatMessageRecord[]; error?: string }>;

  /** Retention prune — delete messages older than `olderThanMs`. */
  pruneOlderThan(params: { olderThanMs: number }): Promise<{ deleted?: number; error?: string }>;
}
