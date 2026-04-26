# admin-client e2e tests

Playwright tests for the admin-client UX journeys. Mirrors the
TMX `e2e/` setup; see `Mentat/planning/PLAYWRIGHT_E2E_TESTING.md`
for the broader strategy.

## Setup

`@playwright/test` is **not yet installed** in admin-client. Add it
manually (no agent installs):

```bash
cd competition-factory-server/admin-client
pnpm add -D @playwright/test
pnpm exec playwright install chromium
```

Then add scripts to `admin-client/package.json`:

```json
"test:e2e":         "playwright test --config e2e/playwright.config.ts",
"test:e2e:ui":      "playwright test --config e2e/playwright.config.ts --ui",
"test:e2e:headed":  "playwright test --config e2e/playwright.config.ts --headed",
"test:e2e:prod":    "TEST_PROD=1 playwright test --config e2e/playwright.config.ts"
```

## Required environment

Tests log in as a real super-admin against the running dev server.
Set in your shell (or a `.env` Playwright reads):

| Var | Default | Notes |
|---|---|---|
| `E2E_ADMIN_EMAIL` | `admin@courthive.com` | super-admin email |
| `E2E_ADMIN_PASSWORD` | _(unset)_ | **required** — fail-fast warning if missing |
| `E2E_API_BASE` | `http://localhost:3000` | server REST base for cleanup helpers |
| `TEST_PROD` | _(unset)_ | when `1`, runs against `pnpm preview` instead of `pnpm dev` |

## Layout

```
e2e/
├── playwright.config.ts        # vite webServer + chromium project
├── helpers/
│   ├── login.ts                # loginAsSuperAdmin (UI) + signInViaApi (REST)
│   ├── selectors.ts            # `S.*` DOM IDs from tmxConstants
│   └── cleanup.ts              # cleanupProvisioner + uniqueProvisionerName
└── journeys/
    ├── 01-login-and-navigate.spec.ts        # smoke: login → /system → navbar
    ├── 02-provisioner-crud.spec.ts          # create via UI; cleanup via API
    ├── 03-api-key-generation.spec.ts        # generated-key reveal modal
    └── 04-provisioner-workspace.spec.ts     # /provisioner shell + sub-tab routing
```

## Cleanup discipline

**Every test that creates a provisioner MUST `cleanupProvisioner` in
`afterEach`.** The bulk script `src/scripts/cleanup-test-provisioners.mjs`
exists for one-off recovery, but should never be needed if test
discipline holds. Track each created `provisionerId` in a
test-scoped variable and pass it to `cleanupProvisioner`.

Use `uniqueProvisionerName()` so concurrent / repeated runs don't
collide. The default prefix is `E2E-Admin-Provisioner-` — distinct
from the `E2E-Provisioner-` prefix the server e2e suite uses.

## Adding a journey

1. Pick the next journey number.
2. Add the spec under `journeys/`.
3. Use `loginAsSuperAdmin(page)` in `beforeEach` (or per-test).
4. If creating server-side data: `cleanupProvisioner` in `afterEach`.
5. Reference DOM via `S.*` not raw selector strings.
6. Prefer API setup over UI for prerequisites the test isn't actually
   exercising — see journey 03 for the pattern.
