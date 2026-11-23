// PostgreSQL supplies the revision and JSON text from one statement. Only that statement can
// authorize use of a handle. Each parse returns an object owned by the individual reader.
export interface ShardBodyHandle {
  readonly token: string;
  parse<T>(): T;
}

export type ShardBodyLocation =
  | { kind: 'shell' }
  | { kind: 'draw'; eventOrd: number; ord: number; eventId: string; drawId: string }
  | { kind: 'participant'; ord: number };

export interface ShardBodySnapshot {
  readonly shell?: ShardBodyHandle;
  readonly draws: ReadonlyMap<string, ShardBodyHandle>;
  readonly participants: ReadonlyMap<number, ShardBodyHandle>;
  release(): void;
}

export function drawBodyKey(eventOrd: number, ord: number): string {
  return eventOrd + '/' + ord;
}

const emptySnapshot: ShardBodySnapshot = {
  draws: new Map(),
  participants: new Map(),
  release() {},
};

// Charge the actual body bytes, both bytes of every JS key/token code unit and fixed
// allowances for the entry, its Map slots and tournament index (even for a lone shell).
// Each entry also reserves its first snapshot lease, so a full LRU can still serve reads.
// Additional overlapping leases draw from the same budget. This is a retention budget;
// the query's private parsed record and PostgreSQL result have request lifetimes.
const entryOverhead = 512;
const leaseOverhead = 384;

interface TournamentEntries {
  readonly id: string;
  shell?: Entry;
  draws: Map<string, Entry>;
  participants: Map<number, Entry>;
}

interface Entry {
  index: TournamentEntries;
  location: ShardBodyLocation;
  drawKey: string;
  token: string;
  body: Buffer;
  bytes: number;
  pins: number;
}

// A short slice can otherwise keep a much larger source string alive.
function ownString(value: string) {
  return Buffer.from(value, 'utf16le').toString('utf16le');
}

export class ShardBodyCache {
  private readonly tournaments = new Map<string, TournamentEntries>();
  private readonly recency = new Set<Entry>(); // LRU to MRU, across kinds and tournaments
  private charged = 0;
  private pinnedBytes = 0;

  constructor(private readonly budget: number) {
    if (!Number.isSafeInteger(budget) || budget < 0) throw new RangeError('Invalid shard cache byte budget');
  }

  get enabled() {
    return this.budget > 0;
  }

  get retainedBytes() {
    return this.charged;
  }

  get tournamentCount() {
    return this.tournaments.size;
  }

  private remove(entry: Entry) {
    const { index, location } = entry;
    this.recency.delete(entry);
    if (location.kind === 'shell') index.shell = undefined;
    else if (location.kind === 'draw') index.draws.delete(entry.drawKey);
    else index.participants.delete(location.ord);
    if (!index.shell && !index.draws.size && !index.participants.size) this.tournaments.delete(index.id);
    if (!entry.pins) this.charged -= entry.bytes;
  }

  put(tournamentId: string, location: ShardBodyLocation, token: string, jsonText: string): void {
    if (!this.budget) return;
    let index = this.tournaments.get(tournamentId);
    const drawKey = location.kind === 'draw' ? drawBodyKey(location.eventOrd, location.ord) : '';
    let prior: Entry | undefined;
    let keyUnits = tournamentId.length + token.length;
    if (location.kind === 'draw') {
      prior = index?.draws.get(drawKey);
      keyUnits += drawKey.length + location.eventId.length + location.drawId.length;
    } else if (location.kind === 'participant') prior = index?.participants.get(location.ord);
    else prior = index?.shell;

    if (prior?.token === token) return; // concurrent fills for the identical physical row version
    if (prior) this.remove(prior); // old snapshots may still own it, including after an oversized replacement

    const overhead = entryOverhead + leaseOverhead + 2 * keyUnits;
    if (overhead + jsonText.length > this.budget) return;
    const bodyBytes = Buffer.byteLength(jsonText, 'utf8');
    const bytes = overhead + bodyBytes;
    if (bytes + this.pinnedBytes > this.budget) return;
    for (const entry of this.recency) {
      if (this.charged + bytes <= this.budget) break;
      if (!entry.pins) this.remove(entry);
    }

    // Removal/eviction above can unlink the last entry of this very tournament.
    index = this.tournaments.get(tournamentId);
    if (!index) {
      index = { id: ownString(tournamentId), draws: new Map(), participants: new Map() };
      this.tournaments.set(index.id, index);
    }
    // A small pooled Buffer could pin a much larger slab. Give each body its own exact-sized backing store.
    const body = Buffer.allocUnsafeSlow(bodyBytes);
    body.write(jsonText, 'utf8');
    const owned: ShardBodyLocation =
      location.kind === 'draw'
        ? {
            kind: 'draw',
            eventOrd: location.eventOrd,
            ord: location.ord,
            eventId: ownString(location.eventId),
            drawId: ownString(location.drawId),
          }
        : location.kind === 'shell'
          ? { kind: 'shell' }
          : { kind: 'participant', ord: location.ord };
    const entry: Entry = { index, location: owned, drawKey, token: ownString(token), body, bytes, pins: 0 };
    if (owned.kind === 'draw') index.draws.set(drawKey, entry);
    else if (owned.kind === 'participant') index.participants.set(owned.ord, entry);
    else index.shell = entry;
    this.recency.add(entry);
    this.charged += bytes;
  }

  private pin(entry: Entry | undefined, leases: Array<() => void>): ShardBodyHandle | undefined {
    if (!entry) return;
    if (entry.pins) {
      if (this.charged + leaseOverhead > this.budget) return;
      this.charged += leaseOverhead;
      this.pinnedBytes += leaseOverhead;
    } else this.pinnedBytes += entry.bytes;
    entry.pins++;
    // Clear the captured reference on release, including for a handle saved independently of its snapshot.
    let pinned: Entry | undefined = entry;
    leases.push(() => {
      if (!pinned) return;
      if (--pinned.pins) {
        this.charged -= leaseOverhead;
        this.pinnedBytes -= leaseOverhead;
      } else {
        this.pinnedBytes -= pinned.bytes;
        if (!this.recency.has(pinned)) this.charged -= pinned.bytes;
      }
      pinned = undefined;
    });
    return {
      get token() {
        if (!pinned) throw new Error('Shard body snapshot was released');
        return pinned.token;
      },
      parse: <T>() => {
        if (!pinned) throw new Error('Shard body snapshot was released');
        // Only a SQL-validated hit promotes the entry. Sending a hint for an unused row does not.
        if (this.recency.delete(pinned)) this.recency.add(pinned);
        return JSON.parse(pinned.body.toString('utf8')) as T;
      },
    };
  }

  snapshot(
    tournamentId: string,
    drawIds: readonly string[],
    eventId: string | undefined,
    includeParticipants: boolean,
  ): ShardBodySnapshot {
    const index = this.tournaments.get(tournamentId);
    if (!index) return emptySnapshot;
    const leases: Array<() => void> = [];
    const shell = this.pin(index.shell, leases);
    const draws = new Map<string, ShardBodyHandle>();
    for (const [key, entry] of index.draws) {
      const at = entry.location;
      if (at.kind !== 'draw' || (at.eventId !== eventId && !drawIds.includes(at.drawId))) continue;
      const handle = this.pin(entry, leases);
      if (handle) draws.set(key, handle);
    }
    const participants = new Map<number, ShardBodyHandle>();
    if (includeParticipants) {
      for (const [ord, entry] of index.participants) {
        const handle = this.pin(entry, leases);
        if (handle) participants.set(ord, handle);
      }
    }
    if (!leases.length) return emptySnapshot;
    return {
      shell,
      draws,
      participants,
      release() {
        for (const release of leases) release();
        leases.length = 0;
        draws.clear();
        participants.clear();
      },
    };
  }
}

export function configuredShardBodyCache(value = process.env.CFS_SHARD_CACHE_BYTES): ShardBodyCache | undefined {
  if (!value || !/^\d+$/.test(value.trim())) return;
  const bytes = Number(value);
  return Number.isSafeInteger(bytes) && bytes > 0 ? new ShardBodyCache(bytes) : undefined;
}
