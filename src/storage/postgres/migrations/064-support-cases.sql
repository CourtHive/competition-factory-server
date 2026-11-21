-- AFFECTS: end-users
-- Description-only support reports. Expiry is absolute, including unfinished resolution sends.
CREATE TABLE IF NOT EXISTS support_cases (
  reference UUID PRIMARY KEY,
  reporter_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  tournament_id TEXT,
  submission_key UUID NOT NULL,
  fingerprint TEXT NOT NULL,
  description TEXT NOT NULL CHECK (octet_length(description) BETWEEN 1 AND 8192),
  evidence JSONB NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (clock_timestamp() + INTERVAL '30 days'),
  resolution TEXT CHECK (octet_length(resolution) <= 16384),
  resolution_author TEXT,
  resolution_key UUID,
  send_state TEXT NOT NULL DEFAULT 'none' CHECK (send_state IN ('none','pending','awaiting_contact','accepted','failed')),
  send_attempts INTEGER NOT NULL DEFAULT 0,
  send_started_at TIMESTAMPTZ,
  send_after TIMESTAMPTZ NOT NULL DEFAULT now(),
  send_email TEXT,
  provider_receipt TEXT,
  send_error TEXT,
  alert_kind TEXT NOT NULL DEFAULT 'received' CHECK (alert_kind IN ('received','send_failed','recovered')),
  alert_state TEXT NOT NULL DEFAULT 'pending' CHECK (alert_state IN ('pending','sent')),
  alert_attempts INTEGER NOT NULL DEFAULT 0,
  alert_after TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (reporter_id, submission_key)
);
CREATE INDEX IF NOT EXISTS support_cases_provider_time ON support_cases(provider_id, submitted_at);
CREATE INDEX IF NOT EXISTS support_cases_reporter_time ON support_cases(reporter_id, submitted_at);
CREATE INDEX IF NOT EXISTS support_cases_expiry ON support_cases(expires_at);
CREATE INDEX IF NOT EXISTS support_cases_sends ON support_cases(send_after) WHERE send_state IN ('pending','awaiting_contact');
CREATE INDEX IF NOT EXISTS support_cases_alerts ON support_cases(alert_after) WHERE alert_state = 'pending';
