-- 060-participation-index-state.sql
-- AFFECTS: end-users
--
-- One fingerprint per tournament of the participation_index rows last written for it, so a save whose derived rows
-- did not change writes nothing. The index used to be deleted and re-inserted on EVERY save, score entries included,
-- one INSERT round trip per participant inside a transaction: a score entry in a 600-participant tournament made
-- about 600 round trips to rewrite rows that had not changed.
--
-- The fingerprint and the rows commit in the same transaction (PostgresParticipationStorage.replaceTournamentRows),
-- so they cannot disagree, across restarts and processes alike. Deleting a tournament's rows deletes its fingerprint.
-- Empty at deploy: each tournament's next save writes its rows exactly as before, then skips while they stay the same.
CREATE TABLE IF NOT EXISTS participation_index_state (
  tournament_id TEXT PRIMARY KEY,
  fingerprint   TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
