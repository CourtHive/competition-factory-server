import { BadRequestException, Logger } from '@nestjs/common';
import { queryGovernor } from 'tods-competition-factory';

/**
 * DRAW INTEGRITY on the whole-record save.
 *
 * `validateL2` proves the factory can LOAD a record and read its events and draws. It never asks whether
 * a draw is CONSISTENT: a WINNER/LOSER link with no `source.roundNumber`, a link naming a structure the
 * draw does not carry, a participant advanced from an undecided matchUp — all of these load cleanly and
 * pass. The factory's integrity hierarchy (`getTournamentInconsistencies`, which fans out to every event
 * and every draw) is what sees them, and it rates each finding: `error` | `warning` | `info`.
 *
 * WHY A MODE, AND WHY `report` IS THE DEFAULT. Production records were saved for years without this
 * check, so some of them may already carry error-severity findings. Enforcing on day one would make
 * those tournaments unsavable from TMX — the director would be locked out of their own event by a
 * defect they did not introduce in this save. So the check ships measuring: `report` logs a structured
 * WARN per record and saves; `enforce` refuses the save on any error-severity finding. Flip to
 * `enforce` once the report lines show what production actually carries.
 *
 * `DRAW_INTEGRITY_MODE`:
 *   - `report`  (default, and the value for anything unrecognised) — log, never refuse
 *   - `enforce` — refuse a save that carries an error-severity finding (warnings never refuse)
 *   - `off`     — skip the scan entirely; an explicit kill switch should the scan cost become a problem
 *
 * Read per call (as `PROJECTION_SNAPSHOT_MODE` is): switching is an env change plus a restart, never a
 * code change, and a spec can set it per test.
 */
export type DrawIntegrityMode = 'report' | 'enforce' | 'off';

export function drawIntegrityMode(): DrawIntegrityMode {
  const value = process.env.DRAW_INTEGRITY_MODE?.trim().toLowerCase();
  if (value === 'enforce' || value === 'off') return value;
  return 'report';
}

export interface IntegrityIssue {
  issueType: string;
  severity: string;
  message: string;
  scope?: string;
  eventId?: string;
  drawId?: string;
  structureId?: string;
  matchUpId?: string;
  fingerprint?: string;
}

export interface DrawIntegrityResult {
  /** Error-severity findings. A scan that could not run is reported here too: it has not shown the record is sound. */
  errors: IntegrityIssue[];
  /** Everything below error severity. Reported, never refused. */
  warnings: IntegrityIssue[];
}

/** One factory `Inconsistency` as the issue shape both integrity paths log. */
export function toIntegrityIssue(inconsistency: any): IntegrityIssue {
  return {
    issueType: inconsistency?.issueType ?? 'UNKNOWN_INCONSISTENCY',
    severity: inconsistency?.severity ?? 'error',
    message: inconsistency?.message ?? '',
    scope: inconsistency?.scope,
    eventId: inconsistency?.eventId,
    drawId: inconsistency?.drawId,
    structureId: inconsistency?.structureId,
    matchUpId: inconsistency?.matchUpId,
    fingerprint: inconsistency?.fingerprint,
  };
}

function scanFailure(message: string): DrawIntegrityResult {
  return { errors: [{ issueType: 'INTEGRITY_SCAN_FAILED', severity: 'error', message }], warnings: [] };
}

export function checkDrawIntegrity(tournamentRecord: any): DrawIntegrityResult {
  let result: any;
  try {
    result = queryGovernor.getTournamentInconsistencies({ tournamentRecord });
  } catch (err: any) {
    return scanFailure(`integrity scan threw: ${err?.message ?? String(err)}`);
  }
  if (result?.error) {
    return scanFailure(
      `integrity scan failed: ${result.error.code ?? result.error.message ?? JSON.stringify(result.error)}`,
    );
  }

  const errors: IntegrityIssue[] = [];
  const warnings: IntegrityIssue[] = [];
  for (const inconsistency of result?.inconsistencies ?? []) {
    const issue = toIntegrityIssue(inconsistency);
    if (issue.severity === 'error') errors.push(issue);
    else warnings.push(issue);
  }
  return { errors, warnings };
}

/** One human-readable line per issue, naming the issue type and where it was found. */
export function describeIntegrityIssue(issue: IntegrityIssue): string {
  const where = [
    issue.drawId && `draw ${issue.drawId}`,
    issue.structureId && `structure ${issue.structureId}`,
    issue.matchUpId && `matchUp ${issue.matchUpId}`,
  ].filter(Boolean);
  const location = where.length ? where.join(' ') : `${issue.scope ?? 'TOURNAMENT'} scope`;
  return `${issue.issueType} (${issue.severity}) at ${location}: ${issue.message}`;
}

/** Bound on the issues carried in one log line: a badly corrupt record can carry hundreds. Totals are always exact. */
export const MAX_LOGGED_ISSUES = 50;

/**
 * The structured payload of the `report` line. JSON, so the line can be grepped by `event` and parsed —
 * the measurement this mode exists to produce has to be countable, not just readable.
 */
export function integrityReportPayload({
  tournamentId,
  mode,
  result,
  source,
}: {
  tournamentId: string;
  mode: DrawIntegrityMode;
  result: DrawIntegrityResult;
  source: string;
}) {
  const issues = [...result.errors, ...result.warnings];
  return {
    event: 'draw-integrity',
    source,
    mode,
    tournamentId,
    errorCount: result.errors.length,
    warningCount: result.warnings.length,
    issueTypes: [...new Set(issues.map((issue) => issue.issueType))],
    issues: issues.slice(0, MAX_LOGGED_ISSUES),
    truncated: issues.length > MAX_LOGGED_ISSUES,
  };
}

/**
 * Run the draw-integrity scan for one record of a wholesale save and act on `DRAW_INTEGRITY_MODE`.
 *
 * Error-severity findings log one structured WARN line (event `draw-integrity`, with tournamentId and the issues) in
 * BOTH modes, so `report` measures exactly what `enforce` would refuse. Below-error findings log at debug: they never
 * refuse, and logging them at WARN on every save would bury the line the measurement is for. `enforce` then refuses
 * the whole payload, as an L2 failure does, before anything is written.
 */
export function gateDrawIntegrity(tournamentId: string, tournamentRecord: any) {
  const mode = drawIntegrityMode();
  if (mode === 'off') return;

  const result = checkDrawIntegrity(tournamentRecord);
  if (!result.errors.length && !result.warnings.length) return;

  const payload = JSON.stringify(integrityReportPayload({ tournamentId, mode, result, source: 'factory-save' }));
  if (!result.errors.length) {
    Logger.debug(payload, 'DrawIntegrity');
    return;
  }

  Logger.warn(payload, 'DrawIntegrity');
  if (mode === 'enforce') {
    throw new BadRequestException({
      error: `Tournament record ${tournamentId} failed draw integrity validation`,
      tournamentId,
      validationErrors: result.errors.map(describeIntegrityIssue),
      validationWarnings: result.warnings.map(describeIntegrityIssue),
      integrityIssues: [...result.errors, ...result.warnings],
    });
  }
}
