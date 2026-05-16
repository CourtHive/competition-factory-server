-- AFFECTS: admin
-- Provisions the audit log for federation-data adapter scrapes (CTS today,
-- LTA/USTA/etc. as they come online). Each call to a
-- `FederationDataAdapter` should ultimately write one row here so we can
-- detect federation HTML changes, enforce rate limits, and prove
-- provenance for downstream awards.
--
-- The CFS `FederationDataService.recordCall()` hook is presently a stub —
-- this migration provisions the schema so the storage abstraction can land
-- in a follow-up PR without a coordinated migration.
--
-- Idempotent: CREATE TABLE / INDEX IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS federation_adapter_calls (
  call_id        uuid PRIMARY KEY,
  provider       text NOT NULL,
  operation      text NOT NULL,
  identifier     text NOT NULL,
  status         text NOT NULL,
  duration_ms    int,
  response_meta  jsonb,
  called_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS federation_adapter_calls_provider
  ON federation_adapter_calls (provider, called_at DESC);
