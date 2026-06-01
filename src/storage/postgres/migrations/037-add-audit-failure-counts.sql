-- 037-add-audit-failure-counts.sql
-- AFFECTS: admin
--
-- Persists AuditService.failureCounts across process restarts so chronic
-- audit-append failures don't look like first-failures every deploy.
--
-- The milestone logic in AuditService emits ERROR at counts 1, 10, 100,
-- 1000, and every 50th thereafter (DEBUG between). Without persistence
-- of the counter, a 100%-failing actionType re-emits the loud "(1x)"
-- ERROR on every boot — masking the chronic state and pretending each
-- deploy starts fresh. With persistence the milestone progression
-- survives restarts and operators see the real failure age.
--
-- Closes the open MED item from the 2026-05-31 design-flaws punch list
-- (architectural-standards.md A4 — in-memory state across restarts).
--
-- The table is intentionally small: one row per actionType currently in
-- failure. Recovery (recordRecovery) deletes the row, so steady-state
-- size is bounded by the count of actionTypes currently broken
-- (typically zero in a healthy system).

CREATE TABLE IF NOT EXISTS audit_failure_counts (
  action_type           TEXT PRIMARY KEY,
  count                 INTEGER     NOT NULL DEFAULT 0,
  first_failure_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_failure_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_failure_message  TEXT
);
