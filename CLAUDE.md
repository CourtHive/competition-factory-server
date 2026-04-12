# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Mentat Orchestration (READ FIRST)

Before doing anything else, read `../Mentat/CLAUDE.md`, `../Mentat/TASKS.md`, `../Mentat/standards/coding-standards.md`, and every file in `../Mentat/in-flight/`. Mentat is the orchestration layer for the entire CourtHive ecosystem; its standards override per-repo conventions when they conflict. If you are about to start **building** (not just planning), you must claim a surface in `../Mentat/in-flight/` and run the air-traffic-control conflict check first. See the parent `../CLAUDE.md` "Mentat Orchestration" section for the full protocol.

## Project Overview

NestJS 11 backend for the CourtHive tournament management platform. Provides a REST API, WebSocket gateway (Socket.IO), and pluggable storage (LevelDB or Postgres). All tournament mutations flow through `tods-competition-factory` with per-tournament locking and per-request async state isolation.

## Commands

```bash
pnpm install              # Install dependencies (pnpm only)
pnpm build                # NestJS CLI compile to build/ (rimraf + nest build)
pnpm start                # Production server (NODE_ENV=production)
pnpm watch                # Dev server with watch (NODE_ENV=development)
pnpm hive-db              # Start net-level-server (LevelDB)
pnpm test                 # Jest tests
pnpm test:watch           # Jest watch mode
pnpm test:cov             # Jest with coverage
pnpm test:e2e             # Playwright end-to-end tests
pnpm lint                 # ESLint with auto-fix
pnpm check-types          # TypeScript type check (tsc --noEmit)
pnpm format               # Prettier on src/ and test/
pnpm storybook            # Storybook dev server on :6007
```

Requires Redis running for cache. Set `STORAGE_PROVIDER=leveldb|postgres` in `.env`.

## Architecture

### NestJS Module Structure

`AppModule` is the root. Key modules:

- **StorageModule** (global) -- pluggable storage selected by `STORAGE_PROVIDER` env var
- **MessagingModule** -- WebSocket gateway (`/tmx` namespace), handles `executionQueue` messages
- **FactoryModule** -- wraps `tods-competition-factory` engine calls
- **AuthModule** -- JWT-based authentication
- **UsersModule** -- user management
- **ProvidersModule** -- multi-tenant provider support
- **CacheModule** -- Redis-backed via `cache-manager` + `@keyv/redis`

### Source Layout

```
src/
  common/        -- shared decorators, guards, interceptors, pipes
  config/        -- NestJS config, environment validation
  helpers/       -- utility functions
  modules/       -- NestJS feature modules (auth, factory, messaging, providers, users)
  scripts/       -- admin CLI scripts (admin-user.mjs, migrate-to-postgres.mjs)
  services/      -- cross-cutting services
  storage/       -- storage interfaces + implementations (leveldb, postgres)
  tests/         -- Jest test config and specs
```

### Storage Abstraction

- **Interfaces**: `src/storage/interfaces/` -- ITournamentStorage, IUserStorage, IProviderStorage, ICalendarStorage, IAuthCodeStorage
- **Implementations**: `src/storage/leveldb/` or `src/storage/postgres/`
- **Facade**: `src/storage/tournament-storage.service.ts` -- adds calendar + permission side-effects
- **DI tokens**: `TOURNAMENT_STORAGE`, `USER_STORAGE`, `PROVIDER_STORAGE`, `CALENDAR_STORAGE`, `AUTH_CODE_STORAGE`

### Concurrency and Isolation

- **Per-tournament mutex**: `tournamentMutex.ts` -- async locking with sorted acquisition (deadlock prevention), 30s timeout
- **Per-request state**: `asyncGlobalState.ts` -- Node.js `async_hooks` so each request gets its own factory engine state

### Mutation Flow

```
Client (Socket.IO) -> TmxGateway.messageHandler()
  -> tmxMessages.executionQueue()
    -> withTournamentLock()
    -> fetchTournamentRecords()
    -> mutationEngine.executionQueue(methods)
    -> saveTournamentRecords()
  -> client.emit('ack')
```

## Key Conventions

- **Package manager**: pnpm only
- **Module system**: CommonJS (NestJS convention)
- **Testing**: Jest with ts-jest transform; specs use `*.spec.ts` suffix
- **`noImplicitAny`**: false in tsconfig
- **`@typescript-eslint/no-explicit-any`**: OFF -- `any` is used extensively
- **Mutations**: Always use `mutationRequest`/`executionQueue` -- never call factory mutations directly
- **Engine resolution**: Pass `drawId`/`eventId` to mutations, not resolved objects
- **Imports**: Sort longest-first
- **Lint discipline**: Zero warnings -- fix all before deploy

## Ecosystem Standards

This repo follows CourtHive ecosystem coding standards documented in the Mentat orchestration repo at `../Mentat/standards/coding-standards.md`.
