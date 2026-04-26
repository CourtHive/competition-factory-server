/**
 * Login helpers for admin-client e2e tests.
 *
 * The admin-client login modal calls `POST /auth/signin` directly. Tests
 * exercise both paths:
 *   - UI login (loginAsSuperAdmin) — drives the modal like a user would
 *   - API login (signInViaApi) — for cleanup helpers that need a token
 *     without rendering a UI
 */
import { expect, type Page, type APIRequestContext } from '@playwright/test';

export const SUPER_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@courthive.com';
export const SUPER_ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';
export const API_BASE = process.env.E2E_API_BASE ?? 'http://localhost:3000';

if (!SUPER_ADMIN_PASSWORD) {
  // Loud at config-time so a missing env var fails predictably during
  // the first test instead of producing an opaque 401 mid-suite.
  console.warn('[e2e] E2E_ADMIN_PASSWORD is not set — login helpers will fail.');
}

export async function loginAsSuperAdmin(page: Page): Promise<void> {
  await page.goto('/');

  // The login icon is always present in the navbar; clicking it opens
  // the modal because no token is set yet on a fresh test page.
  await page.locator('#login').click();

  // The login modal renders email/password inputs through cModal.
  await page.locator('input[autocomplete="email"]').fill(SUPER_ADMIN_EMAIL);
  await page.locator('input[autocomplete="current-password"]').fill(SUPER_ADMIN_PASSWORD);

  await page.locator('#loginButton').click();

  // After login, super-admin lands on /system. Wait for the page
  // container to be visible.
  await expect(page.locator('#tmxSystem')).toBeVisible({ timeout: 10_000 });
}

export async function signInViaApi(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API_BASE}/auth/signin`, {
    data: { email: SUPER_ADMIN_EMAIL, password: SUPER_ADMIN_PASSWORD },
  });
  if (!res.ok()) {
    throw new Error(`signInViaApi failed (${res.status()}): ${await res.text()}`);
  }
  const body = await res.json();
  if (!body?.token) throw new Error(`signInViaApi: missing token in response: ${JSON.stringify(body)}`);
  return body.token;
}
