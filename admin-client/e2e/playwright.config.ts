import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration for admin-client.
 *
 * Mirrors the TMX e2e setup. Tests are stateful (provisioner CRUD,
 * user assignment) — run sequentially.
 *
 * Self-bootstrapping: globalSetup provisions a dedicated e2e super-admin
 * via the existing admin-user.mjs CLI, so no env vars are required for
 * the common case.
 *
 * Optional environment overrides:
 *   E2E_ADMIN_EMAIL       use a different super-admin (default: e2e-admin@courthive.test)
 *   E2E_ADMIN_PASSWORD    override the seeded password
 *   E2E_API_BASE          REST base for direct API calls (default: http://localhost:3000)
 *   TEST_PROD=1           run against `pnpm build && pnpm preview` instead of dev
 */
export default defineConfig({
  testDir: './journeys',
  outputDir: './test-results',
  globalSetup: './global-setup.ts',

  fullyParallel: false,
  workers: 1,

  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,

  reporter: process.env.CI ? [['html', { open: 'never' }]] : [['list']],

  use: {
    // Dedicated ports so e2e never collides with TMX dev (5173) or anything
    // else the developer might have running. 127.0.0.1 (not localhost) so
    // Node doesn't try IPv6 ::1 first.
    baseURL: process.env.TEST_PROD ? 'http://127.0.0.1:4179/admin/' : 'http://127.0.0.1:5179/admin/',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    viewport: { width: 1440, height: 900 },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    // --host 127.0.0.1 forces Vite to bind IPv4 explicitly. Without it
    // Vite defaults to 'localhost' which on macOS resolves to ::1 (IPv6),
    // making the 127.0.0.1 URL unreachable and webServer time out.
    //
    // SERVER must be set so admin-client/baseApi.ts points at the running
    // NestJS server (different origin from Vite). Otherwise /auth/signin
    // and /admin/provisioners/* calls hit Vite and 404.
    command: process.env.TEST_PROD
      ? 'pnpm build && pnpm preview --port 4179 --strictPort --host 127.0.0.1'
      : 'pnpm dev --port 5179 --strictPort --host 127.0.0.1',
    env: {
      SERVER: process.env.SERVER ?? 'http://127.0.0.1:3000',
    },
    url: process.env.TEST_PROD ? 'http://127.0.0.1:4179/admin/' : 'http://127.0.0.1:5179/admin/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
