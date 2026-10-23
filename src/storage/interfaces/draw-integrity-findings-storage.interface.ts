export const DRAW_INTEGRITY_FINDINGS_STORAGE = Symbol('DRAW_INTEGRITY_FINDINGS_STORAGE');

/** What happened to one finding of one draw (migration 056). */
export type DrawIntegrityFindingEvent = 'introduced' | 'baseline' | 'resolved';

/**
 * One change in a draw's finding set. Identifiers, the factory's issue code and severity, and mutation method names:
 * no message, no record content, no user (see migration 056 for why the message is left out).
 *
 * No foreign key to `tournaments`, as with `audit_log`: the history survives a tournament's deletion.
 */
export interface DrawIntegrityFindingRow {
  tournamentId: string;
  drawId: string;
  event: DrawIntegrityFindingEvent;
  /** The factory's `issueType`. */
  code: string;
  severity: string;
  fingerprint: string;
  structureId?: string;
  matchUpId?: string;
  /** Method names of the mutation whose scan observed the change (empty for none). */
  methods: string[];
  /** When the scan observed it (ISO). Set by the scan, not by the write, which may come later. */
  observedAt: string;
}

/** One finding of a draw's open set, as the seed reads it back. */
export interface OpenDrawFinding {
  fingerprint: string;
  code: string;
  severity: string;
  structureId?: string;
  matchUpId?: string;
}

export interface DrawOpenFindings {
  /** This database holds at least one row for the draw: it has been scanned with findings before. */
  known: boolean;
  /** Per fingerprint, the latest row when that row is not `resolved`. */
  open: OpenDrawFinding[];
}

export interface IDrawIntegrityFindingsStorage {
  /** Append rows in one statement. Throws on failure; the caller counts it. */
  append(rows: DrawIntegrityFindingRow[]): Promise<void>;

  /** The open finding set of one draw, from its history. */
  loadOpenFindings(tournamentId: string, drawId: string): Promise<DrawOpenFindings>;
}
