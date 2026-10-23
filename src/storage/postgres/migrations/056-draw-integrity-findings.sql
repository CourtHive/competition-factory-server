-- 056-draw-integrity-findings.sql
-- AFFECTS: admin
-- Draw-integrity findings from the executionQueue scan (src/modules/factory/helpers/executionQueueIntegrity.ts), one
-- row per CHANGE in a draw's finding set. A new internal table that no end-user path reads; no existing table changes.
--
-- ── WHAT A ROW IS ────────────────────────────────────────────────────────────
--
-- The scan diffs each touched draw's findings against the last set it saw. A row is written only when that set
-- changes, never per scan:
--
--   baseline     the first scan this database has ever recorded of the draw found this finding
--   introduced   a scan found a finding the previous set did not hold (`methods` names the mutation's methods)
--   resolved     a finding the previous set held is gone
--
-- A finding is identified by the factory's `fingerprint` (stable per issue and location within the draw). The OPEN
-- set of a draw is, per fingerprint, the latest row whose event is not `resolved`. CFS reads that set back when a
-- draw is not in its in-memory LRU (after a restart, a deploy or an eviction), so a deploy no longer re-reports every
-- broken draw as `baseline`: only a draw with no row here at all is.
--
-- ── NO PERSONAL DATA ─────────────────────────────────────────────────────────
--
-- Identifiers, the factory's issue code and severity, and mutation METHOD NAMES only. The factory's human-readable
-- message is not stored: most are fixed text, but a scan failure carries an exception message, which is not
-- guaranteed to be free of record content. The structured log line (Logger context `DrawIntegrity`) still carries
-- the message for whoever is reading logs. The Grafana role is granted these columns explicitly
-- (courthive-notify grafana/grafana_ro.sql).
--
-- ── RETENTION ────────────────────────────────────────────────────────────────
--
-- None automatic. Volume is bounded by CHANGES in finding sets, not by mutations. If it ever needs pruning, never
-- delete a fingerprint's latest row while it is open: the seed would lose it, and the finding would be reported
-- `introduced` again (and alert) on the draw's next mutation. Prune with:
--
--   DELETE FROM draw_integrity_findings f
--   WHERE f.observed_at < NOW() - INTERVAL '180 days'
--     AND (f.event = 'resolved' OR EXISTS (
--       SELECT 1 FROM draw_integrity_findings g
--       WHERE g.tournament_id = f.tournament_id AND g.draw_id = f.draw_id AND g.fingerprint = f.fingerprint
--         AND (g.observed_at, g.id) > (f.observed_at, f.id)));
--
-- (A `resolved` row may go: with it, the fingerprint either has a later row or none, and no row means closed.)

CREATE TABLE IF NOT EXISTS draw_integrity_findings (
  id BIGSERIAL PRIMARY KEY,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tournament_id TEXT NOT NULL,
  draw_id TEXT NOT NULL,
  event TEXT NOT NULL CONSTRAINT draw_integrity_findings_event_check
    CHECK (event IN ('introduced', 'baseline', 'resolved')),
  code TEXT NOT NULL,
  severity TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  structure_id TEXT,
  matchup_id TEXT,
  methods TEXT[] NOT NULL DEFAULT '{}'
);

-- ── PREMISE ──────────────────────────────────────────────────────────────────
--
-- `CREATE TABLE IF NOT EXISTS` does nothing when a table of this name already exists, whatever its shape. The writer
-- and the seed depend on these exact columns, and a silently different table would surface only as counted write
-- failures after the deploy. So assert the shape here and refuse to boot on anything else. (Before the indexes, so a
-- table missing a column fails HERE, with this message, rather than on the index naming it.)
DO $$
DECLARE
  expected TEXT[] := ARRAY[
    'id:bigint', 'observed_at:timestamp with time zone', 'tournament_id:text', 'draw_id:text', 'event:text',
    'code:text', 'severity:text', 'fingerprint:text', 'structure_id:text', 'matchup_id:text', 'methods:ARRAY'
  ];
  missing TEXT[];
BEGIN
  SELECT array_agg(column_spec) INTO missing
  FROM unnest(expected) AS column_spec
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = current_schema()
      AND c.table_name = 'draw_integrity_findings'
      AND c.column_name || ':' || c.data_type = column_spec
  );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'REFUSING to continue: a `draw_integrity_findings` table already exists without the columns this migration '
      'defines (missing or of another type: %). CREATE TABLE IF NOT EXISTS left it as it was. Rename or drop it, '
      'then re-run.',
      array_to_string(missing, ', ');
  END IF;
END $$;

-- The seed (one draw's history) and the per-draw panels.
CREATE INDEX IF NOT EXISTS idx_draw_integrity_findings_draw ON draw_integrity_findings (draw_id, observed_at);
-- Time-range scans: dashboards and the alert rule.
CREATE INDEX IF NOT EXISTS idx_draw_integrity_findings_observed ON draw_integrity_findings (observed_at);
