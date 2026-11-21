# Description-only support reporting

CFS stores provider-authorized reports in `support_cases` (migration 064). No tournament records,
attachments or anonymizer changes are part of this module. Reporter receipts omit descriptions,
diagnostics, resolutions and contact addresses; inbox/detail/resolution endpoints check trusted
super-admin context independently of the CLI. API keys cannot submit or read reports.

## Activation and routing

New submissions require `SUPPORT_REPORTS_ENABLED=true`. Reading receipts and using the super-admin
inbox/resolution endpoints remain available when intake is disabled. Outbound alerts and resolution
email require the independent `SUPPORT_DISPATCH_ENABLED=true`; a resolution entered while dispatch is
disabled stays queued. Expiry cleanup always runs. Before enabling dispatch, configure `AMS_BASE_URL`,
`AMS_SERVICE_TOKEN`, `SUPPORT_NOTIFY_MODULE` (absolute path to the deployed courthive-notify
`lib/ntfy.mjs`) and `SUPPORT_NTFY_TOPIC`. The existing notifier loads its protected token/URL/Host
configuration; grant that publisher write access to the selected topic and subscribe the inbox owner.
Never put credentials in command arguments. Enabling dispatch without required configuration fails startup.

Roll out the AMS `POST /notifications/support-resolution` contract before enabling CFS dispatch. Confirm the
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

The 30-day expiry applies to the live case. On 21 November 2026 the installed nest script retained
12 nightly core dumps. Its age threshold was configured as ten days. Disk snapshots can preserve a
dump beyond its lifetime on the host. After restoring, purge expired support rows before exposing
the database or enabling workers. [Measured retention and restore procedure](https://github.com/CourtHive/Mentat/blob/main/statuses/2026-11-21-support-release-qualification.md#backup-and-recovery)

The super-admin role owns the support inbox. Operational approvals and evidence live in the
[activation checklist](https://github.com/CourtHive/Mentat/blob/main/planning/TMX_BUG_REPORTING_IMPLEMENTATION.md#before-activation).

The worker logs only
opaque references/failure classes; ntfy never receives descriptions, contacts or tournament IDs.
Support submissions acquire only short support-rate locks, never tournament mutation locks; source
authorization reads the existing tournament metadata projection. No full tournament record is loaded.

## Submission limits

Each account may submit three reports per ten minutes; a provider may submit 200 per hour. This
provider budget allows many staff to report the same outage without the old 20-report ceiling.
Identical retries return the existing receipt before counting quota. Different reports still consume
quota, even when their diagnostic category matches; category-only grouping could hide distinct faults.
