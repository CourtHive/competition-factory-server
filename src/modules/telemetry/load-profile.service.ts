import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';

import { classifyTournament, LIFECYCLE_CLASS, LifecycleClass } from './lifecycleClass';
import { PG_POOL } from 'src/storage/postgres/postgres.config';

const MS_PER_HOUR = 60 * 60 * 1000;
const DEFAULT_FLUSH_INTERVAL_MS = 60_000;

/**
 * Guard against unbounded growth if the flush sink fails for a long time. At
 * one row per (tournament, hour) this is roughly 5000 distinct tournaments
 * inside a single hour before anything is dropped — far above any real load,
 * and low enough that a stuck flush cannot exhaust the heap.
 */
const MAX_BUFFERED_BUCKETS = 5000;

export interface MutationSample {
  tournamentId: string;
  tournamentRecord?: any;
  elapsedMs: number;
  methodCount: number;
  recordBytes: number;
  fenced?: boolean;
}

interface Bucket {
  tournamentId: string;
  bucketStart: number;
  lifecycleClass: LifecycleClass;
  mutationCount: number;
  methodCount: number;
  totalElapsedMs: number;
  maxElapsedMs: number;
  totalRecordBytes: number;
  maxRecordBytes: number;
  fencedCount: number;
}

/**
 * Per-tournament mutation load telemetry (Stage 0 of tournament-affinity
 * sharding). Buffers in memory and flushes aggregates to `tournament_load_profile`
 * on an interval.
 *
 * BUFFERED, NOT SYNCHRONOUS, ON PURPOSE. The mutation path is the thing this
 * work exists to make faster; instrumenting it with a Postgres round-trip per
 * mutation would add latency to the exact code being measured and would change
 * the shape of what it reports. `record()` is a few map operations and returns
 * synchronously — it never awaits, never throws, and is safe to call from
 * inside the tournament lock.
 *
 * A4 — the unflushed window is LOST on restart, deliberately. This is sampling
 * for capacity planning, not accounting: losing up to one flush interval of
 * aggregates cannot produce a wrong decision, and the alternative (persisting
 * every mutation synchronously) is the cost this design exists to avoid. The
 * flush counters themselves are also in-memory and reset on restart, which is
 * accepted for the same reason.
 */
@Injectable()
export class LoadProfileService implements OnModuleDestroy {
  private readonly logger = new Logger(LoadProfileService.name);
  private readonly buckets = new Map<string, Bucket>();
  private readonly flushIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  readonly isEnabled: boolean;

  // A2 — flush failures are counted, throttled, and recovery-reported. Without
  // this a telemetry sink that silently stopped writing would look identical to
  // a system under no load, which is the most misleading possible failure for a
  // capacity-planning surface.
  private flushFailures = 0;
  private droppedSamples = 0;

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {
    this.isEnabled = pool !== null && process.env.LOAD_PROFILE_ENABLED === 'true';
    this.flushIntervalMs = Number(process.env.LOAD_PROFILE_FLUSH_MS) || DEFAULT_FLUSH_INTERVAL_MS;

    if (this.isEnabled) {
      this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
      // Do not hold the event loop open for telemetry.
      this.timer.unref?.();
      this.logger.log(`Load profiling enabled — flushing every ${this.flushIntervalMs}ms`);
    }
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    // Best-effort final flush so a graceful shutdown does not discard the
    // current window. A crash still loses it, per A4 above.
    if (this.isEnabled) await this.flush();
  }

  /**
   * Record one mutation. Synchronous, non-throwing, cheap by construction —
   * called from inside the tournament lock on the mutation hot path.
   */
  record(sample: MutationSample): void {
    if (!this.isEnabled || !sample?.tournamentId) return;

    const now = Date.now();
    const bucketStart = Math.floor(now / MS_PER_HOUR) * MS_PER_HOUR;
    const lifecycleClass = sample.tournamentRecord
      ? classifyTournament(sample.tournamentRecord, now)
      : LIFECYCLE_CLASS.UNKNOWN;

    const key = `${sample.tournamentId}|${bucketStart}|${lifecycleClass}`;
    let bucket = this.buckets.get(key);

    if (!bucket) {
      if (this.buckets.size >= MAX_BUFFERED_BUCKETS) {
        this.droppedSamples += 1;
        // Milestone-throttled: a persistently stuck flush should be loud once
        // and then periodically, not once per dropped sample.
        if (this.droppedSamples === 1 || this.droppedSamples % 1000 === 0) {
          this.logger.error(
            `Load profile buffer full at ${MAX_BUFFERED_BUCKETS} buckets — dropped ${this.droppedSamples} sample(s). ` +
              `Telemetry is incomplete; check the flush failures above.`,
          );
        }
        return;
      }
      bucket = {
        tournamentId: sample.tournamentId,
        bucketStart,
        lifecycleClass,
        mutationCount: 0,
        methodCount: 0,
        totalElapsedMs: 0,
        maxElapsedMs: 0,
        totalRecordBytes: 0,
        maxRecordBytes: 0,
        fencedCount: 0,
      };
      this.buckets.set(key, bucket);
    }

    bucket.mutationCount += 1;
    bucket.methodCount += sample.methodCount || 0;
    bucket.totalElapsedMs += sample.elapsedMs || 0;
    bucket.maxElapsedMs = Math.max(bucket.maxElapsedMs, sample.elapsedMs || 0);
    bucket.totalRecordBytes += sample.recordBytes || 0;
    bucket.maxRecordBytes = Math.max(bucket.maxRecordBytes, sample.recordBytes || 0);
    if (sample.fenced) bucket.fencedCount += 1;
  }

  /**
   * Flush buffered aggregates. Drains the buffer FIRST so a slow flush cannot
   * double-count concurrent `record()` calls, and restores unflushed buckets on
   * failure so a transient DB error costs a delay rather than the window.
   */
  async flush(): Promise<void> {
    if (!this.isEnabled || !this.buckets.size) return;

    const draining = [...this.buckets.values()];
    this.buckets.clear();

    try {
      await this.writeBuckets(draining);
      if (this.flushFailures) {
        this.logger.warn(`Load profile flush recovered after ${this.flushFailures} failure(s)`);
        this.flushFailures = 0;
        this.droppedSamples = 0;
      }
    } catch (err: any) {
      this.flushFailures += 1;
      const isMilestone =
        this.flushFailures === 1 ||
        this.flushFailures === 10 ||
        this.flushFailures === 100 ||
        this.flushFailures % 50 === 0;
      const message = `Load profile flush failed (${this.flushFailures}x): ${err.message}`;
      if (isMilestone) this.logger.error(message);
      else this.logger.debug(message);

      // Merge the undrained buckets back so the window survives a transient
      // error. Bounded by MAX_BUFFERED_BUCKETS on the next record().
      for (const bucket of draining) {
        const key = `${bucket.tournamentId}|${bucket.bucketStart}|${bucket.lifecycleClass}`;
        const current = this.buckets.get(key);
        this.buckets.set(key, current ? mergeBuckets(current, bucket) : bucket);
      }
    }
  }

  private async writeBuckets(buckets: Bucket[]): Promise<void> {
    const valueGroups: string[] = [];
    const params: any[] = [];

    for (const bucket of buckets) {
      const base = params.length;
      const placeholders = Array.from({ length: 10 }, (_, i) => `$${base + i + 1}`);
      placeholders[1] = `to_timestamp(${placeholders[1]}::double precision / 1000)`;
      valueGroups.push(`(${placeholders.join(', ')})`);
      params.push(
        bucket.tournamentId,
        bucket.bucketStart,
        bucket.lifecycleClass,
        bucket.mutationCount,
        bucket.methodCount,
        bucket.totalElapsedMs,
        bucket.maxElapsedMs,
        bucket.totalRecordBytes,
        bucket.maxRecordBytes,
        bucket.fencedCount,
      );
    }

    // Aggregates ACCUMULATE across flushes within the same hour bucket, so the
    // conflict branch adds rather than replaces — except the maxima, which take
    // the greater of the two.
    await this.pool.query(
      `INSERT INTO tournament_load_profile
         (tournament_id, bucket_start, lifecycle_class, mutation_count, method_count,
          total_elapsed_ms, max_elapsed_ms, total_record_bytes, max_record_bytes, fenced_count)
       VALUES ${valueGroups.join(', ')}
       ON CONFLICT (tournament_id, bucket_start, lifecycle_class) DO UPDATE SET
         mutation_count     = tournament_load_profile.mutation_count + EXCLUDED.mutation_count,
         method_count       = tournament_load_profile.method_count + EXCLUDED.method_count,
         total_elapsed_ms   = tournament_load_profile.total_elapsed_ms + EXCLUDED.total_elapsed_ms,
         max_elapsed_ms     = GREATEST(tournament_load_profile.max_elapsed_ms, EXCLUDED.max_elapsed_ms),
         total_record_bytes = tournament_load_profile.total_record_bytes + EXCLUDED.total_record_bytes,
         max_record_bytes   = GREATEST(tournament_load_profile.max_record_bytes, EXCLUDED.max_record_bytes),
         fenced_count       = tournament_load_profile.fenced_count + EXCLUDED.fenced_count,
         updated_at         = NOW()`,
      params,
    );
  }

  /** Operator-visible state without a restart (A4). */
  getStatus() {
    return {
      enabled: this.isEnabled,
      flushIntervalMs: this.flushIntervalMs,
      bufferedBuckets: this.buckets.size,
      maxBufferedBuckets: MAX_BUFFERED_BUCKETS,
      flushFailures: this.flushFailures,
      droppedSamples: this.droppedSamples,
    };
  }
}

function mergeBuckets(a: Bucket, b: Bucket): Bucket {
  return {
    ...a,
    mutationCount: a.mutationCount + b.mutationCount,
    methodCount: a.methodCount + b.methodCount,
    totalElapsedMs: a.totalElapsedMs + b.totalElapsedMs,
    maxElapsedMs: Math.max(a.maxElapsedMs, b.maxElapsedMs),
    totalRecordBytes: a.totalRecordBytes + b.totalRecordBytes,
    maxRecordBytes: Math.max(a.maxRecordBytes, b.maxRecordBytes),
    fencedCount: a.fencedCount + b.fencedCount,
  };
}
