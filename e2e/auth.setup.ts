/**
 * Auth setup — authenticates as different user roles and saves browser state.
 *
 * Saved storage states are reused by test projects so each test doesn't
 * need to log in again.
 *
 * This setup creates two auth states:
 *   - admin.json  — ADMIN role (can create applications AND review/approve)
 *   - client.json — CLIENT role (can create/edit/submit, cannot approve)
 */
import { test as setup } from '@playwright/test';
import { loginViaApi } from './helpers/auth';

const ADMIN_FILE = 'e2e/.auth/admin.json';
const CLIENT_FILE = 'e2e/.auth/client.json';

setup('authenticate as admin', async ({ page }) => {
  await loginViaApi(page, {
    email: process.env.E2E_ADMIN_EMAIL || 'admin@test.com',
    password: process.env.E2E_ADMIN_PASSWORD || 'admin123',
    baseUrl: process.env.SERVER_URL || 'http://localhost:3000',
  });

  // Navigate to admin page to confirm auth works
  await page.goto('/admin/');
  await page.waitForLoadState('networkidle');

  await page.context().storageState({ path: ADMIN_FILE });
});

setup('authenticate as client', async ({ page }) => {
  await loginViaApi(page, {
    email: process.env.E2E_CLIENT_EMAIL || 'client@test.com',
    password: process.env.E2E_CLIENT_PASSWORD || 'client123',
    baseUrl: process.env.SERVER_URL || 'http://localhost:3000',
  });

  await page.goto('/admin/');
  await page.waitForLoadState('networkidle');

  await page.context().storageState({ path: CLIENT_FILE });
});
