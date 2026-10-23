import { drawIntegrityMode, integrityReportPayload, toIntegrityIssue } from './drawIntegrity';
import { queryGovernor, topicConstants } from 'tods-competition-factory';
import { Logger } from '@nestjs/common';

import type { DrawIntegrityResult, IntegrityIssue } from './drawIntegrity';

/**
 * DRAW INTEGRITY on the executionQueue path — REPORT ONLY, and OFF the request path.
 *
 * `gateDrawIntegrity` (drawIntegrity.ts) scans the WHOLESALE save. The executionQueue path — every score, every
 * position assignment, every draw edit TMX makes — ran no integrity check at all. This adds one, under three
 * constraints agreed with CA (2026-10-23):
 *
 *   1. REPORT ONLY. It never refuses or alters a mutation and never blocks the response. `DRAW_INTEGRITY_MODE=off`
 *      disables it; `report` AND `enforce` both mean "report" here. Enforcing on executionQueue is a separate,
 *      future decision: refusing a score because the draw it lands in was ALREADY broken would lock a director out
 *      of their own event, and the introduced/pre-existing split below is the measurement that decision needs.
 *   2. DEFERRED. The scan runs after the tournament lock is released and after the response is produced — one
 *      `setImmediate` per draw, so a large mutation yields the event loop between draws.
 *   3. TOUCHED DRAWS ONLY, found from the factory's own notices (see `drawIdsFromNotice`), never by re-resolving
 *      each method's params.
 *
 * INTRODUCED vs PRE-EXISTING. Every factory `Inconsistency` carries a stable `fingerprint` (factory `finalize`). A
 * bounded per-process LRU keeps the last fingerprint set seen per `tournamentId:drawId`. A finding absent from the
 * previous set was INTRODUCED by this mutation (WARN, naming the methods); one already present is PRE-EXISTING
 * (one LOG line per tracked draw, not one per mutation). The first scan of a draw has no baseline, so its
 * error-severity findings are logged once as `baseline` — a broken draw is still visible — and then tracked.
 *
 * A4: the LRU is in-memory and resets on restart, deliberately. The cost of losing it is one `baseline` line per
 * draw on its next mutation after a restart, never a missed `introduced` line for a draw scanned since.
 *
 * NB: these fingerprints are DRAW-scope (`getDrawInconsistencies` stamps drawId, not eventId/tournamentId), so they
 * are not comparable with the fingerprints in the wholesale-save lines, which come from the tournament scan.
 */

/** Bound on the draws whose last fingerprint set is remembered, per process. */
export const MAX_TRACKED_DRAWS = 5_000;

/**
 * Bound on draw scans waiting for their turn. Each pending scan holds its mutation's records alive, so a burst that
 * outruns the scanner must shed scans rather than memory. Shed scans are counted and logged (A2).
 */
export const MAX_PENDING_SCANS = 500;

/** Method names carried on a log line: a batch can carry hundreds of methods; the names say what kind of change. */
const MAX_LOGGED_METHODS = 20;

const CONTEXT = 'DrawIntegrity';

type Finding = 'introduced' | 'pre-existing' | 'baseline';

export interface DrawScanTarget {
  tournamentId: string;
  drawId: string;
  /** The mutation's OWN drawDefinition — see `snapshotTouchedDraws` for why a reference is an immutable snapshot. */
  drawDefinition: any;
  /**
   * This mutation CREATED the draw (ADD_DRAW_DEFINITION). Its baseline is then known — nothing — so every finding is
   * INTRODUCED, not `baseline`: `addDrawDefinition` accepts a draw whose LOSER link has no source round, and a
   * baseline line would hide that this mutation is what put it there.
   */
  added?: boolean;
}

export interface DrawIntegrityBatch {
  methods: string[];
  draws: DrawScanTarget[];
  /** Draws this mutation deleted: their memory is dropped, so a re-created drawId gets a fresh baseline. */
  deleted: { tournamentId?: string; drawId: string }[];
}

// ── touched draws ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The drawIds a notice names. Called for EVERY notice topic CFS subscribes to (the wrapper in getMutationEngine), so
 * a draw-bearing topic added later is picked up without a list to maintain.
 *
 * Where the factory puts the drawId, by topic:
 *   - MODIFY_MATCHUP, MODIFY_POSITION_ASSIGNMENTS, MODIFY_SEED_ASSIGNMENTS, MODIFY_DRAW_ENTRIES: `drawId`
 *   - ADD_DRAW_DEFINITION, MODIFY_DRAW_DEFINITION: `drawDefinition.drawId` (no top-level drawId)
 *   - ADD_MATCHUPS: each `matchUps[].drawId`
 *   - DELETED_DRAW_IDS: `drawId` — returned as DELETED, never as touched
 *   - ADD_DRAW_DEFINITION also returns the drawId as ADDED: the draw had no state before this mutation
 *
 * MISSED, by construction: a change to a draw that raises no notice naming it. DELETED_MATCHUP_IDS carries no drawId,
 * so a draw is found on that path only when the same mutation also raises a draw-naming notice — measured for
 * `deleteAdHocMatchUps`, which raises MODIFY_DRAW_DEFINITION (executionQueue.integrity.spec.ts pins it); a path that
 * deletes matchUps without one would be missed. A change raised only at EVENT or TOURNAMENT grain
 * (MODIFY_EVENT_ENTRIES, DELETE_PARTICIPANTS) names no draw and is not scanned here; the wholesale-save gate, which
 * scans every draw, is unaffected.
 */
export function drawIdsFromNotice(
  topic: string,
  params: any,
): { touched: string[]; deleted: string[]; added: string[] } {
  const touched: string[] = [];
  const deleted: string[] = [];
  const added: string[] = [];
  for (const item of Array.isArray(params) ? params : [params]) {
    if (!item || typeof item !== 'object') continue;
    if (topic === topicConstants.DELETED_DRAW_IDS) {
      if (typeof item.drawId === 'string') deleted.push(item.drawId);
      continue;
    }
    const candidates = [item.drawId, item.drawDefinition?.drawId, item.matchUp?.drawId];
    if (Array.isArray(item.matchUps)) for (const matchUp of item.matchUps) candidates.push(matchUp?.drawId);
    for (const drawId of candidates) if (typeof drawId === 'string' && drawId) touched.push(drawId);
    const addedId = item.drawDefinition?.drawId;
    if (topic === topicConstants.ADD_DRAW_DEFINITION && typeof addedId === 'string' && addedId) added.push(addedId);
  }
  return { touched, deleted, added };
}

/**
 * Take the scan targets INSIDE the lock, after the save committed.
 *
 * DECISION: the targets are REFERENCES to the mutation's own drawDefinitions, not copies.
 * WHY: they are already an immutable snapshot. Storage parses every fetch from its own row
 * (ITournamentStorage.fetchTournamentRecords), so these objects belong to this request alone: the next mutation on
 * the tournament fetches its own, and nothing writes these once this request has returned. A `structuredClone`
 * here would buy nothing and would be the only cost this check adds INSIDE the lock — measured in
 * executionQueue.integrity.spec.ts, and stated in the PR. The spec also proves a later mutation of the same draw
 * does not change what an earlier scan sees.
 *
 * Returns undefined — and costs nothing beyond reading an env var — when the mode is `off` or no draw was touched.
 * Never throws: a failure here is a failure of the check, never of the mutation.
 */
export function snapshotTouchedDraws({
  touchedDrawIds,
  deletedDrawIds,
  addedDrawIds,
  tournamentRecords,
  methods,
}: {
  touchedDrawIds?: Set<string>;
  deletedDrawIds?: Set<string>;
  addedDrawIds?: Set<string>;
  tournamentRecords?: Record<string, any>;
  methods?: any[];
}): DrawIntegrityBatch | undefined {
  try {
    if (drawIntegrityMode() === 'off') return undefined;
    if (!touchedDrawIds?.size && !deletedDrawIds?.size) return undefined;

    const draws: DrawScanTarget[] = [];
    const found = new Set<string>();
    for (const [tournamentId, record] of Object.entries(tournamentRecords ?? {})) {
      for (const event of record?.events ?? []) {
        for (const drawDefinition of event?.drawDefinitions ?? []) {
          const drawId = drawDefinition?.drawId;
          if (!touchedDrawIds?.has(drawId) || found.has(drawId)) continue;
          found.add(drawId);
          draws.push({ tournamentId, drawId, drawDefinition, added: !!addedDrawIds?.has(drawId) });
        }
      }
    }

    const deleted = [...(deletedDrawIds ?? [])].map((drawId) => ({ drawId }));
    if (!draws.length && !deleted.length) return undefined;
    return { methods: methodNames(methods), draws, deleted };
  } catch (err: any) {
    recordScanFailure(`snapshot failed: ${err?.message ?? String(err)}`);
    return undefined;
  }
}

function methodNames(methods?: any[]): string[] {
  const names = (methods ?? []).map((method) => method?.method).filter((name) => typeof name === 'string');
  return [...new Set(names)].slice(0, MAX_LOGGED_METHODS);
}

// ── fingerprint memory (LRU) ─────────────────────────────────────────────────────────────────────────────────────

interface DrawMemory {
  fingerprints: Set<string>;
  /** The pre-existing line has been logged for this draw; it is not repeated while the draw stays tracked and broken. */
  preExistingLogged: boolean;
}

/** Insertion-ordered Map as an LRU: a read re-inserts, so the first key is always the least recently used. */
const memory = new Map<string, DrawMemory>();

const memoryKey = (tournamentId: string | undefined, drawId: string) => `${tournamentId ?? ''}:${drawId}`;

function recall(key: string): DrawMemory | undefined {
  const entry = memory.get(key);
  if (entry) {
    memory.delete(key);
    memory.set(key, entry);
  }
  return entry;
}

function remember(key: string, entry: DrawMemory) {
  memory.delete(key);
  memory.set(key, entry);
  while (memory.size > MAX_TRACKED_DRAWS) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
    stats.evicted += 1;
  }
}

function forgetDraw(tournamentId: string | undefined, drawId: string) {
  if (tournamentId !== undefined) {
    memory.delete(memoryKey(tournamentId, drawId));
    return;
  }
  // DELETED_DRAW_IDS may not say which tournament: drop the drawId under every tournament (drawIds are unique).
  for (const key of [...memory.keys()]) if (key.endsWith(`:${drawId}`)) memory.delete(key);
}

// ── counters (A2) ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * In-process counters. CFS has no metrics surface (no Prometheus/StatsD client), so the sink is the structured log
 * lines; these counters exist so the failure throttle below has something to count, and so specs can read the
 * effect of a scan without parsing logs.
 */
const stats = {
  scans: 0,
  introduced: 0,
  preExisting: 0,
  baseline: 0,
  failures: 0,
  shed: 0,
  evicted: 0,
};
let pendingScans = 0;
let failingSince = 0;

export function drawIntegrityScanStats() {
  return { ...stats, pending: pendingScans, tracked: memory.size };
}

/** Test seam: forget every remembered draw and zero the counters. */
export function resetDrawIntegrityMemory() {
  memory.clear();
  for (const key of Object.keys(stats) as (keyof typeof stats)[]) stats[key] = 0;
  pendingScans = 0;
  failingSince = 0;
}

/** First failure, then 10, 100, 1000 …, then every 50th: an operator sees the class without the spam. */
function shouldLogCount(count: number) {
  if (count === 1) return true;
  if (count % 50 === 0) return true;
  return Number.isInteger(Math.log10(count));
}

function recordScanFailure(message: string, context?: Record<string, any>) {
  stats.failures += 1;
  failingSince += 1;
  if (!shouldLogCount(stats.failures)) return;
  Logger.warn(
    JSON.stringify({
      event: 'draw-integrity-scan-failed',
      source: 'executionQueue',
      failures: stats.failures,
      message,
      ...context,
    }),
    CONTEXT,
  );
}

function recordScanSuccess() {
  if (!failingSince) return;
  Logger.warn(
    JSON.stringify({ event: 'draw-integrity-scan-recovered', source: 'executionQueue', afterFailures: failingSince }),
    CONTEXT,
  );
  failingSince = 0;
}

function recordShed(batch: DrawIntegrityBatch, target: DrawScanTarget) {
  stats.shed += 1;
  if (!shouldLogCount(stats.shed)) return;
  Logger.warn(
    JSON.stringify({
      event: 'draw-integrity-scan-shed',
      source: 'executionQueue',
      shed: stats.shed,
      pendingLimit: MAX_PENDING_SCANS,
      tournamentId: target.tournamentId,
      drawId: target.drawId,
      methods: batch.methods,
    }),
    CONTEXT,
  );
}

// ── the scan ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The factory call, behind an object CFS owns, so a spec can observe or replace it. The factory's governors cannot be
 * spied on where CI resolves the package: the published ESM build exports them as module namespaces, which are not
 * configurable. (A `link:` checkout can resolve differently and let a spy through — a local pass proved nothing.)
 */
export const drawScanner = {
  getDrawInconsistencies: (params: { drawDefinition: any; drawId: string }): any =>
    queryGovernor.getDrawInconsistencies(params),
};

function partition(issues: IntegrityIssue[]): DrawIntegrityResult {
  return {
    errors: issues.filter((issue) => issue.severity === 'error'),
    warnings: issues.filter((issue) => issue.severity !== 'error'),
  };
}

function logFinding({
  finding,
  target,
  methods,
  issues,
  scanMs,
  extra,
}: {
  finding: Finding;
  target: DrawScanTarget;
  methods: string[];
  issues: IntegrityIssue[];
  scanMs: number;
  extra?: Record<string, any>;
}) {
  const payload = {
    ...integrityReportPayload({
      tournamentId: target.tournamentId,
      mode: 'report',
      result: partition(issues),
      source: 'executionQueue',
    }),
    finding,
    drawId: target.drawId,
    methods,
    scanMs,
    ...extra,
  };
  const line = JSON.stringify(payload);
  if (finding === 'pre-existing') Logger.log(line, CONTEXT);
  else Logger.warn(line, CONTEXT);
}

/**
 * Scan one draw and diff its findings against what this process last saw for it. Exported for the unit spec; the
 * mutation path reaches it only through `scheduleDrawIntegrityScan`. Never throws.
 */
export function scanDraw(target: DrawScanTarget, methods: string[]) {
  try {
    const startedAt = performance.now();
    let result: any;
    try {
      result = drawScanner.getDrawInconsistencies({ drawDefinition: target.drawDefinition, drawId: target.drawId });
    } catch (err: any) {
      recordScanFailure(`integrity scan threw: ${err?.message ?? String(err)}`, {
        tournamentId: target.tournamentId,
        drawId: target.drawId,
      });
      return;
    }
    const scanMs = Math.round((performance.now() - startedAt) * 100) / 100;
    if (result?.error || !Array.isArray(result?.inconsistencies)) {
      const reason = result?.error?.code ?? result?.error?.message ?? 'no inconsistencies array';
      recordScanFailure(`integrity scan failed: ${reason}`, {
        tournamentId: target.tournamentId,
        drawId: target.drawId,
      });
      return;
    }

    stats.scans += 1;
    recordScanSuccess();

    const issues: IntegrityIssue[] = result.inconsistencies.map(toIntegrityIssue);
    // A finding the factory could not fingerprint is identified by everything that locates it instead.
    const fingerprintOf = (issue: IntegrityIssue) =>
      issue.fingerprint ??
      [issue.issueType, issue.structureId, issue.matchUpId, issue.message].map((part) => part ?? '').join('|');
    const current = new Set(issues.map(fingerprintOf));

    const key = memoryKey(target.tournamentId, target.drawId);
    // A draw this mutation created had nothing before it: diff against nothing, so its findings are introduced.
    const previous = target.added ? { fingerprints: new Set<string>(), preExistingLogged: false } : recall(key);

    if (!previous) {
      const errors = issues.filter((issue) => issue.severity === 'error');
      if (errors.length) {
        stats.baseline += 1;
        logFinding({ finding: 'baseline', target, methods, issues: errors, scanMs });
      }
      // preExistingLogged stays false: the next mutation of a still-broken draw says so once, at LOG — the count of
      // draws that stay broken WHILE BEING MUTATED is what an `enforce` decision on this path needs to know.
      remember(key, { fingerprints: current, preExistingLogged: false });
      return;
    }

    const introduced = issues.filter((issue) => !previous.fingerprints.has(fingerprintOf(issue)));
    const preExisting = issues.filter((issue) => previous.fingerprints.has(fingerprintOf(issue)));
    const resolvedCount = [...previous.fingerprints].filter((fingerprint) => !current.has(fingerprint)).length;

    if (introduced.length) {
      stats.introduced += 1;
      logFinding({
        finding: 'introduced',
        target,
        methods,
        issues: introduced,
        scanMs,
        extra: { preExistingCount: preExisting.length, resolvedCount },
      });
    }

    let preExistingLogged = previous.preExistingLogged;
    if (preExisting.length && !preExistingLogged) {
      stats.preExisting += 1;
      logFinding({ finding: 'pre-existing', target, methods, issues: preExisting, scanMs });
      preExistingLogged = true;
    }
    // A draw that comes clean may break again later; its next pre-existing set is news and is logged again.
    if (!current.size) preExistingLogged = false;

    remember(key, { fingerprints: current, preExistingLogged });
  } catch (err: any) {
    recordScanFailure(`integrity diff failed: ${err?.message ?? String(err)}`, {
      tournamentId: target.tournamentId,
      drawId: target.drawId,
    });
  }
}

/**
 * Queue the scans of one mutation's touched draws. Call it AFTER the lock is released and the response is built.
 *
 * One `setImmediate` per draw, all queued now: `setImmediate` callbacks run in FIFO order, so the scans of two
 * mutations on the same draw run in mutation order (the lock ordered the mutations, and each schedules its scans as
 * it returns), which is what the introduced/pre-existing diff depends on. Chaining the draws of a batch instead would
 * let a later mutation's scan of a draw overtake an earlier one's.
 *
 * Never throws, and nothing it schedules can throw into the request: the request has already returned.
 */
export function scheduleDrawIntegrityScan(batch: DrawIntegrityBatch | undefined) {
  if (!batch) return;
  try {
    for (const { tournamentId, drawId } of batch.deleted) setImmediate(() => forgetDraw(tournamentId, drawId));
    for (const target of batch.draws) {
      if (pendingScans >= MAX_PENDING_SCANS) {
        recordShed(batch, target);
        continue;
      }
      pendingScans += 1;
      setImmediate(() => {
        pendingScans -= 1;
        scanDraw(target, batch.methods);
      });
    }
  } catch (err: any) {
    recordScanFailure(`scheduling failed: ${err?.message ?? String(err)}`);
  }
}
