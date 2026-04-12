# Playwright E2E Harness — Mentat Relationship

## This Harness Lives Here

The Playwright tests in this directory test the admin client UI for the sanctioning workflow. They belong in `competition-factory-server` because they test this server's functionality — same as the Jest unit tests and existing `*.e2e.spec.ts` files.

## What Mentat Does With These Tests

Mentat (CourtHive/mentat) is the **development orchestration control plane** — it coordinates work across the ecosystem but doesn't own the test suites. Mentat will:

- **Run these tests** as part of cascade update workflows (factory change → rebuild server → run e2e)
- **Monitor health** by periodically triggering `pnpm test:e2e` and reporting failures
- **Trigger on PRs** — when a PR touches sanctioning code, Mentat ensures e2e tests pass before merge

## What Mentat Owns (that doesn't belong here)

- **Cross-repo integration tests** — "does a factory publish break the server build?"
- **Cascade coordination scripts** — auto-publish chain from factory → consumers
- **Health check workflows** — daily lint/test/dependency sweeps across all repos
- **Agent configurations** — which models run which checks, budgets, schedules

## Reference

See `/Users/charlesallen/Development/GitHub/CourtHive/mentat/README.md` for Mentat's architecture and the Paperclip SOURCE document in `mentat/planning/` for the orchestration philosophy.
