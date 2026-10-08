import type { ChatMessageRecord } from 'src/storage/interfaces';

export const MAX_CHAT_MESSAGE_LENGTH = 2000;

/** Shape a persisted chat record into the `chatMessage`/`chatHistory` wire
 *  payload clients consume (timestamp in epoch ms, like the legacy relay). */
export function toWireMessage(record: ChatMessageRecord): {
  seq: number;
  userName: string;
  message: string;
  timestamp: number;
  clientMsgId?: string;
  isAdmin: boolean;
} {
  return {
    seq: record.seq,
    userName: record.userName,
    message: record.message,
    timestamp: Date.parse(record.createdAt),
    clientMsgId: record.clientMsgId,
    isAdmin: record.isAdmin,
  };
}

/** Wire shape for the super-admin monitor — adds the provider/tournament
 *  identity used to render the grouping pills. */
export function toAdminFeed(record: ChatMessageRecord): Record<string, any> {
  return {
    ...toWireMessage(record),
    tournamentId: record.tournamentId,
    providerId: record.providerId,
    providerAbbr: record.providerAbbr,
    tournamentName: record.tournamentName,
  };
}
