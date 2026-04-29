# Postgres migrations

`MigrationRunnerService` (see `../migration-runner.service.ts`) reads every `.sql` file in this directory on Factory-Server boot, compares them against the `schema_migrations` tracking table, and applies any pending migrations in filename order.

Each migration runs inside its own transaction. If any migration fails, the server does not start.

## File naming

`NNN-short-description.sql`, where `NNN` is a zero-padded incrementing number. The leading digits are how the runner determines apply order — never reuse or reorder a number that has already shipped.

## Idempotency

Existing migrations use idempotent DDL (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, etc.). Keep new migrations idempotent so that re-running against an already-migrated DB is a no-op rather than an error.

## `-- AFFECTS:` header (required for new migrations)

Every new migration must declare its blast radius via a header in the first ten lines of the file:

```sql
-- AFFECTS: admin
-- Adds a column to user_provisioners for tracking impersonation grants.
ALTER TABLE user_provisioners ADD COLUMN IF NOT EXISTS ...;
```

Allowed values:

| Value | Meaning | Examples |
|---|---|---|
| `admin` | Touches only admin / provisioning / audit / internal-tooling tables. End-user data flows are untouched. | `user_provisioners`, `provider_config`, `auth_codes`, `audit_*` |
| `end-users` | Touches tables read or written by the live user-facing path. A bad migration here breaks user-visible features. | `tournaments`, `participants`, `matchUps`, `events`, `drawDefinitions` |
| `mixed` | Both. Treated the same as `end-users` for safety. | A backfill that walks tournaments to populate a new admin-side audit field |

Missing or unrecognized headers are treated as `end-users` (fail-safe to loud).

### Why this matters

`mentat-push-server.sh` (in the Mentat repo) reads the AFFECTS header of every new migration about to ship and decides whether the deploy needs operator confirmation:

- All new migrations `admin` → quiet notice, deploy proceeds
- Any new migration `end-users` / `mixed` / unspecified → halt, requires `yes-apply-to-prod` typed confirmation

The classification is forward-only — existing migrations (001–019) don't have the header and won't be re-classified. The gate only inspects migrations that aren't yet on nest's currently-deployed release.

## Adding a migration

1. Create `NNN-description.sql` with the next sequence number
2. Top of file: `-- AFFECTS: <admin|end-users|mixed>` followed by a one-line description
3. Use idempotent DDL
4. Test against a fresh `mentat-local` (run `Mentat/scripts/mentat-snapshot-from-prod.sh` first to clone prod, then deploy with the new migration to mentat and verify Factory-Server boots cleanly)
5. When the deploy script halts at the AFFECTS gate, that's working as designed — type the confirmation if you've reviewed the migration and accept the risk
