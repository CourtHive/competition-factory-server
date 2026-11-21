# Description-only support reporting

CFS stores provider-authorized reports in `support_cases` (migration 064). No tournament records,
attachments or anonymizer changes are part of this module. Reporter receipts omit descriptions,
diagnostics, resolutions and contact addresses; inbox/detail/resolution endpoints check trusted
super-admin context independently of the CLI. API keys cannot submit or read reports.

## Activation and routing

Disabled unless `SUPPORT_REPORTS_ENABLED=true`. Before enabling, configure `AMS_BASE_URL`,
`AMS_SERVICE_TOKEN`, `SUPPORT_NOTIFY_MODULE` (absolute path to the deployed courthive-notify
`lib/ntfy.mjs`) and `SUPPORT_NTFY_TOPIC`. The existing notifier loads its protected token/URL/Host
configuration; grant that publisher write access to the selected topic and subscribe the inbox owner.
Never put credentials in command arguments. Enabling without required configuration fails startup.

Roll out the AMS `POST /notifications/support-resolution` contract before enabling CFS. Confirm the
edge routes `/support/reports` and `/admin/support/reports` to CFS; the module creates no static admin
page. TMX uses its existing authenticated API client. Do not enable outbound mail on the reproduction
simulation to operate this feature. No configuration, migration or external send is applied by reading
this runbook; deployment remains a separately authorized action.

## CLI inbox and sender

Use the existing authenticated super-admin session via `SUPPORT_ADMIN_TOKEN` in the environment.
Set `SUPPORT_CFS_URL` to the trusted CFS origin; HTTPS is required outside loopback. Redirects are refused.

```bash
node src/scripts/support-reports.mjs list
node src/scripts/support-reports.mjs list 50
node src/scripts/support-reports.mjs show <opaque-reference>
node src/scripts/support-reports.mjs resolve <opaque-reference> /private/path/resolution.txt
```

A file argument of `-` reads resolution text from stdin. Only the HTTP endpoint resolves recipients.
The first written resolution is immutable; repeating the same command returns its existing state,
while different text is refused. Missing verified contact becomes `awaiting_contact` and is rechecked.
The worker checks at most ten eligible cases per minute, with one active sweep per process and
Postgres row locks/leases coordinating processes. Notifications and send intent survive restarts.

Mail retries retain the same key, recipient and first-attempt timestamp; the intent/lease commits
before I/O. Up to five attempts occur within one hour of first dispatch. A changed verified mailbox
or an exhausted/ambiguous send requires manual review, recorded as `failed`; the CLI does not silently
mint a fresh key or risk duplicate email. Track any further investigation in a minimized Mentat ticket.
AMS/Resend acceptance is reported as `accepted`, with delivery **unknown**. Delivery/bounce webhooks
are not implemented or claimed. ntfy uses durable pending state and bounded retries; it is at-least-once,
so a crash after remote acceptance can produce a repeated opaque-reference alert.

## Expiry, backups and operational readiness

All report content, diagnostics, contact/send details and idempotency keys expire 30 days after
submission. Every read/send filters expiry immediately; a minute sweep deletes at most 100 expired
rows at a time. Open status and retries never extend retention. No report-content audit tombstone is
retained. Later work belongs in a reviewed technical ticket, without raw descriptions or contact data
by default. Account contact information follows its existing policy.

Database backups can contain historical rows until the backup itself expires. The inspected canonical
Mentat `scripts/nest-backup-postgres.sh` sets ten-day backup retention and explicitly warns that its
host copy can drift. Verify actual retention and any additional backup copies before rollout; this
implementation does not erase historical dumps. Before a restored database is exposed or workers are
enabled, purge `support_cases WHERE expires_at <= now()` and retain expiry filters. A restore does not
restart the 30-day clock. Include this check in the operator's restore procedure.

Assign a named inbox owner, verify topic ACL/subscription and mail configuration, check migration 064
against a disposable database, and qualify rate/size limits before activation. The worker logs only
opaque references/failure classes; ntfy never receives descriptions, contacts or tournament IDs.
Support submissions acquire only short support-rate locks, never tournament mutation locks; source
authorization reads the existing tournament metadata projection. No full tournament record is loaded.
