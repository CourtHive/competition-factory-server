# Storage Configuration

The server stores all data in **PostgreSQL**. It is the only supported backend
(the former LevelDB backend and the `net-level` client were removed on
2026-05-30). Records are stored as JSONB documents with a handful of
denormalized columns for the fields the server queries directly.

> The canonical, published version of this page lives in the Storybook docs
> under **Storage → Overview** and **Storage → PostgreSQL Setup**
> (<https://courthive.github.io/competition-factory-server/>). This file is the
> local dev/ops runbook; keep the two in sync when the storage layer changes.

## Local Setup

### 1. Install and create the database

```bash
# macOS (Homebrew)
brew install postgresql@17
brew services start postgresql@17

# Create the database
createdb courthive
```

> **Note:** By default the server connects as `PG_USER` (defaults to
> `courthive`). On a local dev machine you can skip creating a separate role and
> just set `PG_USER` to your system user (run `whoami` to check). The value must
> match an existing PostgreSQL role — run `psql -d postgres -c "\du"` to see what
> roles exist.
>
> If you prefer a dedicated role:
>
> ```bash
> psql -d postgres -c "CREATE ROLE courthive WITH LOGIN;"
> psql -d postgres -c "GRANT ALL PRIVILEGES ON DATABASE courthive TO courthive;"
> # On PostgreSQL 15+ you also need:
> psql -d courthive -c "GRANT ALL ON SCHEMA public TO courthive;"
> ```

**Important:** `dotenv` does **not** override environment variables that are
already set in the shell. If `PG_USER` (or any `PG_*` variable) is exported in
your shell profile, that value takes precedence over `.env`. Run `echo $PG_USER`
to verify, and `unset PG_USER` or correct your profile if needed.

### 2. Configure `.env`

```env
PG_HOST=localhost        # PostgreSQL host
PG_PORT=5432             # PostgreSQL port (default: 5432)
PG_USER=courthive        # must match an existing PostgreSQL role
PG_PASSWORD=             # empty for local trust auth
PG_DATABASE=courthive    # database name
```

### 3. Start the server

```bash
pnpm watch    # development
pnpm start    # production
```

The schema is applied **automatically on startup** — there is no manual
`psql -f` step. See [Schema Migrations](#schema-migrations) below.

## Schema Migrations

Migrations are applied automatically by `MigrationRunnerService`
(`src/storage/postgres/migration-runner.service.ts`) on module init:

- It reads every `.sql` file in `src/storage/postgres/migrations/` and compares
  them against a `schema_migrations` tracking table.
- Pending migrations are applied in filename order, each inside its own
  transaction.
- If any migration fails, **the server does not start** — failing loudly is
  preferred over running against a half-migrated schema.
- Application is serialised across concurrent runners (parallel Jest workers,
  multiple booting instances) via a session-level advisory lock, so a
  new-table migration cannot race itself.

Migration files are idempotent (`CREATE TABLE IF NOT EXISTS`,
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`), so migrations applied by hand
before the runner existed are recorded as already-applied without harm.

To add a new migration, drop a new numbered `.sql` file into the migrations
directory; it will apply on the next boot.

## Architecture Overview

```text
Controllers / Gateways
        |
    Services (FactoryService, AuthService, etc.)
        |
    TournamentStorageService   <-- calendar + permission side-effects
        |
    Storage Interfaces         <-- ITournamentStorage, IUserStorage, etc.
        |
    +-------------------+
    |    PostgreSQL     |
    |  JSONB documents  |
    +-------------------+
```

The `StorageModule` is a `@Global()` NestJS module that provides 5 storage
interfaces via dependency injection:

- `TOURNAMENT_STORAGE` → `ITournamentStorage`
- `USER_STORAGE` → `IUserStorage`
- `PROVIDER_STORAGE` → `IProviderStorage`
- `CALENDAR_STORAGE` → `ICalendarStorage`
- `AUTH_CODE_STORAGE` → `IAuthCodeStorage`

### Domain Side-Effects

Write operations that involve domain logic (calendar updates, permission
checks) go through `TournamentStorageService`, which wraps the raw
`ITournamentStorage` interface. Read-only public queries use `ITournamentStorage`
directly. This separation keeps domain logic in one place regardless of how the
raw records are persisted.

## PostgreSQL Schema

The schema uses JSONB columns to store the full tournament/user/provider
objects, with denormalized columns for commonly queried fields. The initial
tables are:

```text
tournaments   — tournament_id (PK), provider_id, tournament_name, start_date, end_date, data (JSONB)
users         — email (PK), password, provider_id, roles (JSONB), permissions (JSONB), data (JSONB)
providers     — provider_id (PK), organisation_abbreviation, organisation_name, data (JSONB)
calendars     — provider_abbr (PK), provider (JSONB), tournaments (JSONB array)
reset_codes   — code (PK), email
access_codes  — code (PK), email
```

Later migrations add user UUIDs, user↔provider associations, tournament
assignments, an audit log, provisioner tables, and bolt-history event storage.
The authoritative source is the ordered SQL in
`src/storage/postgres/migrations/`.
