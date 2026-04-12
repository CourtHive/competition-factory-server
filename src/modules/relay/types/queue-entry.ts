export type QueueEntryKind = 'bolt-history' | 'scorebug' | 'video-board';

export interface QueueEntry {
  sequence: number;
  venueId: string;
  kind: QueueEntryKind;
  matchUpId: string;
  payload: unknown;
  createdAt: string;
  attempts: number;
  lastError?: string;
}
