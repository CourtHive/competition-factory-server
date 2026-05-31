-- 035-add-registration-participant-link.sql
--
-- HiveID Phase 2-B — closes the loop between a RegistrationEntry and
-- the TODS Participant it graduates into on acceptance.
--
-- `participant_id`  — UUID assigned by the factory at addParticipants
--                     time. Stamped on the entry by the server-side
--                     accept orchestrator. Reverse-lookup applicant
--                     ↔ Participant becomes O(1) instead of scanning
--                     every Participant in the tournament record.
--                     Logical FK only — the factory owns Participant
--                     existence, not Postgres.
-- `event_entries`   — Per-event entry payload captured at acceptance
--                     time. Keeps a record of which events the
--                     applicant was actually graduated into (the
--                     director may accept into a subset of the events
--                     the applicant picked).

ALTER TABLE registration_entries
  ADD COLUMN IF NOT EXISTS participant_id uuid,
  ADD COLUMN IF NOT EXISTS event_entries  jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_registration_entries_participant
  ON registration_entries (participant_id)
  WHERE participant_id IS NOT NULL;
