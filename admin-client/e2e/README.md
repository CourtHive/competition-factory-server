# admin-client e2e tests

Playwright tests for the admin-client UX journeys. Mirrors the
TMX `e2e/` setup; see `Mentat/planning/PLAYWRIGHT_E2E_TESTING.md`
for the broader strategy.

## Run

```bash
# In one terminal (NestJS server — required)
cd competition-factory-server
pnpm watch

# In another terminal
cd competition-factory-server/admin-client
pnpm test:e2e
```

Playwright auto-starts admin-client on port 5179 (dedicated, won't
collide with the user's regular dev server) and `globalSetup`:

1. Pings the NestJS server on `http://127.0.0.1:3000/factory/version`
   and fails fast with a clear message if it's not running.
2. Provisions a dedicated `e2e-admin@courthive.test` super-admin via
   `src/scripts/admin-user.mjs` (idempotent — re-runs reset the
   password).

No env vars are required for the common case. Browser binaries
install once via `pnpm exec playwright install chromium`.

### Optional environment overrides

| Var | Default | Notes |
|---|---|---|
| `E2E_ADMIN_EMAIL` | `e2e-admin@courthive.test` | override the seeded email |
| `E2E_ADMIN_PASSWORD` | `e2e-test-password-do-not-reuse` | override the seeded password |
| `E2E_API_BASE` | `http://127.0.0.1:3000` | server REST base for direct API calls |
| `SERVER` | `http://127.0.0.1:3000` | exposed to admin-client at build time as `process.env.SERVER` so `baseApi.ts` can route to the server |
| `TEST_PROD` | _(unset)_ | when `1`, runs against `pnpm preview --port 4179` instead of `pnpm dev` |

## Layout

```
e2e/
├── playwright.config.ts        # vite webServer + chromium project + globalSetup
├── global-setup.ts             # idempotently seeds the e2e super-admin
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
