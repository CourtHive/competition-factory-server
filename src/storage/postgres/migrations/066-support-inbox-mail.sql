-- AFFECTS: end-users
-- Only newly accepted bug reports enqueue inbox mail. Existing cases and suggestions stay idle.
ALTER TABLE support_cases
  ADD COLUMN IF NOT EXISTS inbox_mail_state text NOT NULL DEFAULT 'none'
    CHECK (inbox_mail_state IN ('none','pending','accepted','failed')),
  ADD COLUMN IF NOT EXISTS inbox_mail_after timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS inbox_mail_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS inbox_mail_to text;
CREATE INDEX IF NOT EXISTS support_cases_inbox_mail ON support_cases(inbox_mail_after)
  WHERE inbox_mail_state = 'pending';
