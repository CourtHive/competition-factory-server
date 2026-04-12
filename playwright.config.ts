import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // sanctioning tests have sequential workflow dependencies
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  timeout: 30_000,

  use: {
    baseURL: process.env.ADMIN_URL || 'http://localhost:5173/admin/',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    // Auth setup — runs first, saves storage state for other projects
    {
      name: 'auth-setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/admin.json',
      },
      dependencies: ['auth-setup'],
    },
  ],

  // Start both the NestJS server and the admin client dev server
  webServer: [
    {
      command: 'pnpm watch',
      url: 'http://localhost:3000/factory/version',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'cd admin-client && pnpm dev',
      url: 'http://localhost:5173/admin/',
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
  ],
});
