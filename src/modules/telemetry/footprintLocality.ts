import { Logger } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';

const routes = [
  'queue',
  'privateQuery',
  'operator',
  'publicDraw',
  'publicStructure',
  'publicInfo',
  'publicParticipants',
  'publicSchedule',
  'publicEvent',
  'warmEvent',
] as const;
export type LocalityRoute = (typeof routes)[number];

export interface FootprintAccess {
  kind: 'queue' | 'read';
  tournamentId?: string;
  route?: LocalityRoute;
  /** True only for a confirmed partial storage result. */
  physicalRead?: boolean;
  /** Undefined when the footprint could not be determined. An empty list names no draws. */
  drawIds?: readonly string[];
  eligible?: boolean;
  /** Authoritative tournament version for this read, including for draws from that same snapshot. */
  version?: string | number;
  /** Already-known serialized tournament size. Never serialize a record for this collector. */
  recordBytes?: number;
}

const MINUTE = 60_000;
const defaults = {
  durationMs: 60 * MINUTE,
  reportMs: MINUTE,
  maxAgeMs: 15 * MINUTE,
  maxEntries: 512, // per level
  maxKeyBytes: 64 * 1024, // per level, retained key/version strings at two bytes per ASCII character
};
const maxDraws = 32;
const maxTokenLength = 256;
const distanceBounds = [0, 1, 3, 7, 15, 31, 63, 127, 255, 511];
const ageBoundsMs = [1000, 10_000, MINUTE, 5 * MINUTE, 15 * MINUTE];
const sizeBounds = [4096, 16_384, 65_536, 262_144, 1_048_576, 4_194_304, 16_777_216];

type Counts = Record<string, number>;
function increment(counts: Counts, key: string) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function bucket(value: number, bounds: number[]) {
  return bounds.find((upper) => value <= upper) ?? 'over';
}

function validToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxTokenLength;
}

interface Entry {
  time: number;
  sequence: number;
  version?: string;
  invalidated: boolean;
  keyBytes: number;
}

class History {
  readonly entries = new Map<string, Entry>(); // oldest to newest
  keyBytes = 0;

  private drop(key: string) {
    this.keyBytes -= this.entries.get(key)!.keyBytes;
    this.entries.delete(key);
  }

  trim(now: number, limits: typeof defaults, evictions: Counts) {
    for (const [key, entry] of this.entries) {
      const reason =
        now - entry.time >= limits.maxAgeMs
          ? 'age'
          : this.entries.size > limits.maxEntries
            ? 'count'
            : this.keyBytes > limits.maxKeyBytes
              ? 'bytes'
              : undefined;
      if (!reason) break;
      increment(evictions, reason);
      this.drop(key);
    }
  }

  observe(
    keys: string[],
    now: number,
    sequence: number,
    version: string | undefined,
    group: string,
    counts: Counts,
    gaps: Counts,
  ) {
    // Measure every key against the same pre-access state. Sibling draws in one footprint have no order.
    for (const key of keys) {
      const prior = this.entries.get(key);
      if (!prior) {
        increment(counts, group + '/unseenInHistory');
        continue;
      }
      let distance = 0;
      if (prior.sequence !== sequence - 1) {
        for (const other of this.entries.values()) {
          if (other.sequence > prior.sequence) distance++;
        }
      }
      let outcome = 'accessProxy';
      if (prior.invalidated) outcome = 'afterCommit';
      else if (version !== undefined && prior.version !== undefined) {
        outcome = version === prior.version ? 'versionMatched' : 'versionChanged';
      }
      const distinct = bucket(distance, distanceBounds);
      const age = bucket(now - prior.time, ageBoundsMs);
      increment(counts, `${group}/${outcome}/${distinct}/${age}`);
      increment(gaps, `${group}/${outcome}/${bucket(sequence - prior.sequence - 1, distanceBounds)}`);
    }
    for (const key of keys) {
      if (this.entries.has(key)) this.drop(key);
      const keyBytes = 2 * (key.length + (version?.length ?? 0));
      this.entries.set(key, { time: now, sequence, version, keyBytes, invalidated: false });
      this.keyBytes += keyBytes;
    }
  }

  clear() {
    this.entries.clear();
    this.keyBytes = 0;
  }
}

function intervalCounts() {
  return {
    accesses: 0,
    commits: 0,
    deletes: 0,
    unidentifiedCommits: 0,
    unknownTournament: 0,
    unknownDrawScope: 0,
    oversizedDrawScope: 0,
    failedReports: 0,
    tournamentAccessGaps: {} as Counts,
    drawAccessGaps: {} as Counts,
    commitSerializedCodeUnits: {} as Counts,
    routes: {} as Counts,
    physicalReads: 0,
    requests: {} as Counts,
    recordBytes: {} as Counts,
    tournament: {} as Counts,
    draw: {} as Counts,
    tournamentEvictions: {} as Counts,
    drawEvictions: {} as Counts,
  };
}

type LocalityReport = ReturnType<typeof intervalCounts> & {
  event: 'footprint_locality';
  final: boolean;
  elapsedMs: number;
  intervalMs: number;
  limits: typeof defaults;
  resident: { tournament: number; draw: number; keyBytes: number };
};

// The constructor is also the test seam. Production starts at most one finite observation per worker boot.
export class FootprintLocality {
  private readonly secret = randomBytes(32);
  private readonly tournaments = new History();
  private readonly draws = new History();
  private readonly start = performance.now();
  private since = this.start;
  private sequence = 0;
  private closed = false;
  private counts = intervalCounts();
  private readonly reportTimer: ReturnType<typeof setTimeout>;
  private readonly stopTimer: ReturnType<typeof setTimeout>;

  constructor(
    private readonly limits: typeof defaults,
    private readonly emit: (report: LocalityReport) => void,
  ) {
    this.reportTimer = setInterval(() => this.flush(false), limits.reportMs).unref();
    this.stopTimer = setTimeout(() => this.stop(), limits.durationMs).unref();
  }

  private token(value: string) {
    return createHmac('sha256', this.secret).update(value).digest('base64url');
  }

  private trim(now: number) {
    this.tournaments.trim(now, this.limits, this.counts.tournamentEvictions);
    this.draws.trim(now, this.limits, this.counts.drawEvictions);
  }

  private active(now: number) {
    if (!this.closed && now - this.start >= this.limits.durationMs) this.stop();
    return !this.closed;
  }

  observeAccess({ kind, tournamentId, drawIds, eligible, version, recordBytes, route, physicalRead }: FootprintAccess) {
    const now = performance.now();
    if (!this.active(now)) return;
    this.trim(now);
    this.sequence++;
    this.counts.accesses++;
    if (physicalRead === true) this.counts.physicalReads++;
    increment(this.counts.routes, route && routes.includes(route) ? route : 'unspecified');
    const eligibility = eligible === undefined ? 'unknown' : eligible ? 'eligible' : 'ineligible';
    const source = kind === 'read' || kind === 'queue' ? kind : 'unknown';
    const group = `${source}/${eligibility}`;
    increment(this.counts.requests, group);
    const size = Number.isSafeInteger(recordBytes) && recordBytes! >= 0 ? bucket(recordBytes!, sizeBounds) : 'unknown';
    increment(this.counts.recordBytes, `${group}/${size}`);
    if (!validToken(tournamentId)) {
      this.counts.unknownTournament++;
      this.counts.unknownDrawScope++;
      return;
    }
    const tournament = this.token(tournamentId);
    const versionKey = validToken(version)
      ? this.token('s' + version)
      : Number.isSafeInteger(version)
        ? this.token('n' + version)
        : undefined;
    this.tournaments.observe(
      [tournament],
      now,
      this.sequence,
      versionKey,
      group,
      this.counts.tournament,
      this.counts.tournamentAccessGaps,
    );
    this.tournaments.trim(now, this.limits, this.counts.tournamentEvictions);
    if (!Array.isArray(drawIds) || drawIds.length > maxDraws || !Array.from(drawIds).every(validToken)) {
      this.counts.unknownDrawScope++;
      if (Array.isArray(drawIds) && drawIds.length > maxDraws) this.counts.oversizedDrawScope++;
      return;
    }
    const keys = [...new Set<string>(drawIds)].map((id) => tournament + '/' + this.token(id));
    this.draws.observe(keys, now, this.sequence, versionKey, group, this.counts.draw, this.counts.drawAccessGaps);
    this.draws.trim(now, this.limits, this.counts.drawEvictions);
  }

  /** Invoke once per successfully committed tournament. A refusal, rollback, or attempted write is not a commit. */
  observeCommit(tournamentId?: string, operation: 'save' | 'delete' = 'save', serializedCodeUnits?: number) {
    const now = performance.now();
    if (!this.active(now)) return;
    this.trim(now);
    this.counts.commits++;
    if (operation === 'delete') this.counts.deletes++;
    else {
      const size =
        Number.isSafeInteger(serializedCodeUnits) && serializedCodeUnits! >= 0
          ? String(bucket(serializedCodeUnits!, sizeBounds))
          : 'unknown';
      increment(this.counts.commitSerializedCodeUnits, size);
    }
    const tournament = validToken(tournamentId) ? this.token(tournamentId) : undefined;
    if (!tournament) this.counts.unidentifiedCommits++;
    for (const [key, entry] of this.tournaments.entries) {
      if (tournament === undefined || key === tournament) entry.invalidated = true;
    }
    for (const [key, entry] of this.draws.entries) {
      if (tournament === undefined || key.startsWith(tournament + '/')) entry.invalidated = true;
    }
  }

  private flush(final: boolean) {
    const now = performance.now();
    if (!final && !this.active(now)) return;
    this.trim(now);
    const resident = {
      tournament: this.tournaments.entries.size,
      draw: this.draws.entries.size,
      keyBytes: this.tournaments.keyBytes + this.draws.keyBytes,
    };
    try {
      this.emit({
        event: 'footprint_locality',
        final,
        elapsedMs: Math.round(now - this.start),
        intervalMs: Math.round(now - this.since),
        ...this.counts,
        limits: this.limits,
        resident,
      });
      this.counts = intervalCounts();
      this.since = now;
    } catch {
      // Carry the fixed-cardinality counters forward if the logging sink fails.
      this.counts.failedReports++;
    }
  }

  stop() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.stopTimer);
    clearInterval(this.reportTimer);
    this.flush(true);
    this.tournaments.clear();
    this.draws.clear();
    if (footprintLocality === this) footprintLocality = undefined;
  }
}

function configuredCollector() {
  if (process.env.FOOTPRINT_LOCALITY_ENABLED !== 'true') return undefined;
  const requested = Number(process.env.FOOTPRINT_LOCALITY_WINDOW_MS);
  const durationMs =
    Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, 24 * 60 * MINUTE) : defaults.durationMs;
  const logger = new Logger('FootprintLocality');
  return new FootprintLocality({ ...defaults, durationMs }, (report) => logger.log(report));
}

export let footprintLocality = configuredCollector();
