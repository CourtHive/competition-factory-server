# Storage Configuration

The server supports multiple storage backends, selected at startup via the `STORAGE_PROVIDER` environment variable. The default is `leveldb` — the same backend the server has always used — so existing deployments continue to work without any changes.

## Supported Backends

| Backend    | `STORAGE_PROVIDER` | Description                                         |
|------------|-------------------|-----------------------------------------------------|
| LevelDB    | `leveldb`         | Default. Uses `@gridspace/net-level-client`.        |
| PostgreSQL | `postgres`        | JSONB document storage with `pg` (node-postgres).   |

## Quick Start: Switching to PostgreSQL

### 1. Install and create the database

```bash
# macOS (Homebrew)
brew install postgresql@17
brew services start postgresql@17

# Create the database
createdb courthive
```

### 2. Apply the schema

```bash
psql -d courthive -f src/storage/postgres/migrations/001-initial-schema.sql
```

### 3. Migrate existing data from LevelDB

Make sure the LevelDB server (`net-level-server`) is running, then:

```bash
# Preview what will be migrated (no writes)
node src/scripts/migrate-to-postgres.mjs --dry-run --verbose

# Perform the migration
node src/scripts/migrate-to-postgres.mjs --verbose
```

The migration tool:
- Reads **all** data from LevelDB (tournaments, users, providers, calendars, auth codes)
- Writes it into PostgreSQL using `INSERT ... ON CONFLICT DO UPDATE`
- Is safe to run multiple times — it will update existing records rather than duplicate them
- Does **not** modify or delete anything in LevelDB

### 4. Update `.env` and restart

Add these variables to your `.env` file:

```env
STORAGE_PROVIDER=postgres

PG_HOST=localhost
PG_PORT=5432
PG_USER=courthive
PG_PASSWORD=
PG_DATABASE=courthive
```

Then restart the server:

```bash
pnpm watch    # development
pnpm start    # production
```

Clients will see the same tournaments and data — they are unaware of the storage backend.

## Configuration Reference

### LevelDB (default)

No additional configuration needed beyond the existing `DB_*` variables:

```env
STORAGE_PROVIDER=leveldb   # or simply omit this line

DB_HOST=localhost
DB_PORT=3838
DB_USER=admin
DB_PASS=adminpass
```

### PostgreSQL

```env
STORAGE_PROVIDER=postgres

PG_HOST=localhost        # PostgreSQL host
PG_PORT=5432             # PostgreSQL port (default: 5432)
PG_USER=courthive        # Database user
PG_PASSWORD=             # Database password (empty for local trust auth)
PG_DATABASE=courthive    # Database name
```

## Rolling Back to LevelDB

If you need to switch back:

1. Set `STORAGE_PROVIDER=leveldb` in `.env` (or remove the line entirely)
2. Restart the server

Your LevelDB data is untouched — the migration script never modifies it. Any data written while running PostgreSQL will **not** be in LevelDB, so you may want to migrate in the opposite direction first if needed.

## Architecture Overview

```
Controllers / Gateways
        |
    Services (FactoryService, AuthService, etc.)
        |
    TournamentStorageService   <-- calendar + permission side-effects
        |
    Storage Interfaces         <-- ITournamentStorage, IUserStorage, etc.
        |
    +---------------+---------------+
    |   LevelDB     |  PostgreSQL   |
    |   (default)   |  (new)        |
    +---------------+---------------+
```

The `StorageModule` is a global NestJS module that provides 5 storage interfaces via dependency injection. The backend implementation is selected once at startup based on `STORAGE_PROVIDER` — no runtime switching.

### Domain Side-Effects

Write operations that involve domain logic (calendar updates, permission checks) go through `TournamentStorageService`, which wraps the raw `ITournamentStorage` interface. Read-only public queries use `ITournamentStorage` directly.

This separation means that adding a new storage backend only requires implementing the 5 raw interfaces — no domain logic needs to be duplicated.

## PostgreSQL Schema

The schema uses JSONB columns to store the full tournament/user/provider objects, with denormalized columns for commonly queried fields:

```
tournaments   — tournament_id (PK), provider_id, tournament_name, start_date, end_date, data (JSONB)
users         — email (PK), password, provider_id, roles (JSONB), permissions (JSONB), data (JSONB)
providers     — provider_id (PK), organisation_abbreviation (UNIQUE), organisation_name, data (JSONB)
calendars     — provider_abbr (PK), provider (JSONB), tournaments (JSONB array)
reset_codes   — code (PK), email
access_codes  — code (PK), email
```

The full schema SQL is at `src/storage/postgres/migrations/001-initial-schema.sql`.

## Migration Script Reference

```
node src/scripts/migrate-to-postgres.mjs [options]

Options:
  --dry-run, -d    Read from LevelDB and report counts without writing
  --verbose, -v    Print each record as it's migrated
```

The script requires both LevelDB (`DB_*` vars) and PostgreSQL (`PG_*` vars) to be configured in `.env`. The LevelDB server must be running.
