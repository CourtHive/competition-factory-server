import type {
  PresenceMember,
  PublishOptions,
  RealtimeChannel,
  RealtimeNamespace,
  RealtimePresence,
  RealtimePublisher,
} from 'src/modules/messaging/realtime/realtime.types';

export interface PublishedEvent {
  channel: RealtimeChannel;
  event: string;
  payload: any;
  options?: PublishOptions;
}

/**
 * In-memory realtime port for specs. It implements the same interfaces the
 * production adapter does, so a spec that injects it cannot drift from the
 * port's shape (A1), and it records every publish for assertions.
 */
export class RecordingRealtime implements RealtimePublisher, RealtimePresence {
  readonly published: PublishedEvent[] = [];
  private readonly roomMembers = new Map<string, PresenceMember[]>();

  publish(channel: RealtimeChannel, event: string, payload: unknown, options?: PublishOptions): boolean {
    this.published.push({ channel, event, payload, ...(options && { options }) });
    return true;
  }

  async members(channel: RealtimeChannel): Promise<PresenceMember[]> {
    return this.roomMembers.get(key(channel)) ?? [];
  }

  async rooms(namespace: RealtimeNamespace, prefix: string): Promise<string[]> {
    return [...this.roomMembers.keys()]
      .filter((k) => k.startsWith(`${namespace}|${prefix}`))
      .map((k) => k.slice(namespace.length + 1));
  }

  setMembers(channel: RealtimeChannel, members: PresenceMember[]): void {
    this.roomMembers.set(key(channel), members);
  }

  /** Publishes to `room`, optionally narrowed to one event name. */
  to(room: string, event?: string): PublishedEvent[] {
    return this.published.filter((p) => p.channel.room === room && (!event || p.event === event));
  }
}

function key(channel: RealtimeChannel): string {
  return `${channel.namespace}|${channel.room}`;
}
