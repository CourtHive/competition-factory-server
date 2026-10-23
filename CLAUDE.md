# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Mentat Orchestration (READ FIRST)

Before doing anything else, read `../Mentat/CLAUDE.md`, `../Mentat/TASKS.md`, `../Mentat/standards/coding-standards.md`, and every file in `../Mentat/in-flight/`. Mentat is the orchestration layer for the entire CourtHive ecosystem; its standards override per-repo conventions when they conflict. If you are about to start **building** (not just planning), you must claim a surface in `../Mentat/in-flight/` and run the air-traffic-control conflict check first. See the parent `../CLAUDE.md` "Mentat Orchestration" section for the full protocol.

## Branching — cut from `dev`, not `main` (CA, 2026-10-23)

`dev` is this repo's integration branch, as in factory, TMX, components and the dev-flow services. **Branch from
`origin/dev` and open PRs against `dev`.** `main` advances only at checkpoints, by merging `dev` into it. CA: *"let's
set CFS up to have the dev flow that the other repos have"*. `dev` was created from `main` at `ca34483f` (the #1017
merge), byte-identical. **Renovate targets `dev`** (`baseBranches` in `renovate.json`).

| workflow | trigger | consequence |
| --- | --- | --- |
| `ci.yml` | bare `pull_request:` + `push: [main]` | a PR into `dev` gets the full gate. A direct push to `dev` gets **no** run, so land work by PR |
| `release-please.yml` | `push: [main]` ONLY | a checkpoint merge **refreshes** the release PR. Nothing is tagged or released |
| `back-merge.yml` | `release: published` + `workflow_dispatch` | after a release, opens the `main` → `dev` PR with the release-bot App token |
| `sync-i18n.yml` | `push: [main]`, path-filtered on the admin client's `en.json` | an i18n change on `dev` syncs only once it reaches `main` |
| `deploy-storybook.yml` | `push: [main, master]`, path-filtered | storybook publishes only from `main` |

**Deploys build `main`.** mentat's checkout of this repo is on `main` (as factory's is on `master` and TMX's on `main`),
so work merged to `dev` reaches dev and prod only after a checkpoint.

**`dev` is protected** (no deletion, no force-push; no required checks) and `delete_branch_on_merge` is on: merged feature
branches delete themselves, and the protected `dev`/`main` heads of checkpoint and back-merge PRs survive. The checkpoint
merge is a **merge commit**, never a squash, so release-please's changelog keeps every conventional commit; so is the
back-merge (`main` → `dev`) after each release. Judge local branches by PR **state**, not ancestry
(`gh pr list --repo CourtHive/competition-factory-server --state merged --head <branch>`).

## Project Overview

NestJS 11 backend for the CourtHive tournament management platform. Provides a REST API, WebSocket gateway (Socket.IO), and Postgres storage. All tournament mutations flow through `tods-competition-factory` with per-tournament locking and per-request async state isolation.

## Commands

```bash
pnpm install              # Install dependencies (pnpm only)
pnpm build                # NestJS CLI compile to build/ (rimraf + nest build)
pnpm start                # Production server (NODE_ENV=production)
pnpm watch                # Dev server with watch (NODE_ENV=development)
pnpm test                 # Vitest: the full suite, incl. the *.e2e.spec.ts that need a live stack
pnpm test:unit            # Vitest: everything except the specs that need a live stack
pnpm test:watch           # Vitest watch mode
pnpm test:cov             # Vitest with coverage
pnpm test:e2e             # Playwright end-to-end tests
pnpm lint                 # ESLint — non-mutating, fails on any warning
pnpm lint:fix             # ESLint with auto-fix (rewrites source)
pnpm check-types          # TypeScript type check (tsc --noEmit)
pnpm format               # Prettier on src/ and test/
pnpm storybook            # Storybook dev server on :6007
```

Requires Redis running for cache. Postgres is the only storage backend (configured via `PG_*` env vars in `.env`).

## Architecture

### NestJS Module Structure

`AppModule` is the root. Key modules:

- **StorageModule** (global) -- Postgres-backed storage
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
  tests/         -- test helpers, generators and specs (Vitest: vitest.config.mts, unit subset vitest.unit.config.mts)
```

### Storage Abstraction

- **Interfaces**: `src/storage/interfaces/` -- ITournamentStorage, IUserStorage, IProviderStorage, ICalendarStorage, IAuthCodeStorage
- **Implementation**: `src/storage/postgres/` (LevelDB removed 2026-05-30)
- **Facade**: `src/storage/tournament-storage.service.ts` -- adds calendar + permission side-effects
- **DI tokens**: `TOURNAMENT_STORAGE`, `USER_STORAGE`, `PROVIDER_STORAGE`, `CALENDAR_STORAGE`, `AUTH_CODE_STORAGE`

### Concurrency and Isolation

- **Per-tournament mutex**: `tournamentMutex.ts` -- async locking with sorted acquisition (deadlock prevention), 30s timeout
- **Per-request state**: `asyncGlobalState.ts` -- Node.js `async_hooks` so each request gets its own factory engine state

### Mutation Flow

```
Client -> POST /factory -> FactoryController.executionQueue()
  -> mutationAuthorization.gate() + stampVerifiedIdentity()
  -> factoryService.executionQueue()
    -> withTournamentLock()
    -> fetchTournamentRecords()
    -> mutationEngine.executionQueue(methods)
    -> saveTournamentRecords()
  -> broadcastMutation() to the /tmx room, invalidateTournamentCache()
  -> HTTP response (TMX turns it into the ack)
```

The socket `executionQueue` handler was retired 2026-10-09 (CA). The `/tmx` socket carries
subscriptions and server push only.

## Key Conventions

- **Package manager**: pnpm only
- **Module system**: CommonJS (NestJS convention)
- **Testing**: Vitest (`vitest.config.mts`), transformed through `unplugin-swc` so Nest
  decorator metadata survives; specs use `*.spec.ts` suffix. Spec files run serially
  (`fileParallelism: false`) because the suite shares one Postgres — see
  `src/tests/config/teardown.ts`.
- **`noImplicitAny`**: false in tsconfig
- **`@typescript-eslint/no-explicit-any`**: OFF -- `any` is used extensively
- **Mutations**: Always use `mutationRequest`/`executionQueue` -- never call factory mutations directly
- **Engine resolution**: Pass `drawId`/`eventId` to mutations, not resolved objects
- **Imports**: Sort longest-first
- **Lint discipline**: Zero warnings -- fix all before deploy

## Ecosystem Standards

This repo follows CourtHive ecosystem coding standards documented in the Mentat orchestration repo at `../Mentat/standards/coding-standards.md`.
