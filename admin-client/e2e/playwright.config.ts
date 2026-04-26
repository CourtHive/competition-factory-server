import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration for admin-client.
 *
 * Mirrors the TMX e2e setup. Tests are stateful (provisioner CRUD,
 * user assignment) — run sequentially.
 *
 * Required environment variables (set in .env or shell):
 *   E2E_ADMIN_EMAIL       super-admin email for login (default: admin@courthive.com)
 *   E2E_ADMIN_PASSWORD    super-admin password
 *   E2E_API_BASE          REST base for direct API cleanup (default: http://localhost:3000)
 *
 * Optional:
 *   TEST_PROD=1           run against `pnpm build && pnpm preview` instead of dev
 */
export default defineConfig({
  testDir: './journeys',
  outputDir: './test-results',

  fullyParallel: false,
  workers: 1,

  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,

  reporter: process.env.CI ? [['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: process.env.TEST_PROD ? 'http://localhost:4173/admin/' : 'http://localhost:5173/admin/',
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
    command: process.env.TEST_PROD ? 'pnpm build && pnpm preview' : 'pnpm dev',
    url: process.env.TEST_PROD ? 'http://localhost:4173/admin/' : 'http://localhost:5173/admin/',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
