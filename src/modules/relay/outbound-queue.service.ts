import { Injectable } from '@nestjs/common';
import netLevel from 'src/services/levelDB/netLevel';

import { QueueEntry, QueueEntryKind } from './types/queue-entry';

// Local namespace constant — kept inline (not in src/services/levelDB/constants.ts)
// to avoid editing a file other waves may also be touching. Promote to the constants
// file in a follow-up if desired.
const CLOUD_RELAY_QUEUE_NAMESPACE = 'cloudRelayQueue';
const SEQUENCE_KEY = '__seq';

export interface EnqueueArgs {
  venueId: string;
  kind: QueueEntryKind;
  matchUpId: string;
  payload: unknown;
}

@Injectable()
export class OutboundQueueService {
  async enqueue(args: EnqueueArgs): Promise<void> {
    const sequence = await this.nextSequence();
    const entry: QueueEntry = {
      sequence,
      venueId: args.venueId,
      kind: args.kind,
      matchUpId: args.matchUpId,
      payload: args.payload,
      createdAt: new Date().toISOString(),
      attempts: 0,
    };
    await netLevel.set(CLOUD_RELAY_QUEUE_NAMESPACE, { key: entryKey(sequence), value: entry });
  }

  async peek(limit: number): Promise<QueueEntry[]> {
    const entries = await this.loadAll();
    return entries.slice(0, Math.max(0, limit));
  }

  async ack(sequences: number[]): Promise<void> {
    for (const sequence of sequences) {
      await netLevel.delete(CLOUD_RELAY_QUEUE_NAMESPACE, { key: entryKey(sequence) });
    }
  }

  async nack(sequence: number, error: string): Promise<void> {
    const stored = (await netLevel.get(CLOUD_RELAY_QUEUE_NAMESPACE, {
      key: entryKey(sequence),
    })) as QueueEntry | undefined | null;
    if (!stored) return;
    stored.attempts += 1;
    stored.lastError = error;
    await netLevel.set(CLOUD_RELAY_QUEUE_NAMESPACE, { key: entryKey(sequence), value: stored });
  }

  async depth(): Promise<number> {
    const entries = await this.loadAll();
    return entries.length;
  }

  private async nextSequence(): Promise<number> {
    const current = (await netLevel.get(CLOUD_RELAY_QUEUE_NAMESPACE, {
      key: SEQUENCE_KEY,
    })) as { value: number } | number | undefined | null;
    const currentNumber = typeof current === 'number' ? current : (current?.value ?? 0);
    const next = currentNumber + 1;
    await netLevel.set(CLOUD_RELAY_QUEUE_NAMESPACE, { key: SEQUENCE_KEY, value: next });
    return next;
  }

  private async loadAll(): Promise<QueueEntry[]> {
    const raw = (await netLevel.list(CLOUD_RELAY_QUEUE_NAMESPACE, { all: true })) as
      | { key: string; value: any }[]
      | undefined;
    const entries: QueueEntry[] = (raw ?? [])
      .filter((row) => row?.key !== SEQUENCE_KEY)
      .map((row) => row.value as QueueEntry)
      .filter((entry): entry is QueueEntry => Boolean(entry?.sequence));
    entries.sort((a, b) => a.sequence - b.sequence);
    return entries;
  }
}

function entryKey(sequence: number): string {
  // Zero-padded so a string sort would also produce sequence order if needed.
  return `entry-${sequence.toString().padStart(16, '0')}`;
}
