/**
 * Login helpers for admin-client e2e tests.
 *
 * The admin-client login modal calls `POST /auth/signin` directly. Tests
 * exercise both paths:
 *   - UI login (loginAsSuperAdmin) — drives the modal like a user would
 *   - API login (signInViaApi) — for cleanup helpers that need a token
 *     without rendering a UI
 *
 * Credentials default to a dedicated e2e super-admin that
 * `e2e/global-setup.ts` provisions before the suite runs (idempotently
 * via the existing admin-user.mjs CLI). Override via env if you have
 * a different setup (e.g. running against a shared staging DB).
 */
import { expect, type Page, type APIRequestContext } from '@playwright/test';

export const E2E_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@courthive.test';
export const E2E_ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'e2e-test-password-do-not-reuse';
export const API_BASE = process.env.E2E_API_BASE ?? 'http://localhost:3000';

// Backwards-compat aliases for the original symbol names
export const SUPER_ADMIN_EMAIL = E2E_ADMIN_EMAIL;
export const SUPER_ADMIN_PASSWORD = E2E_ADMIN_PASSWORD;

export async function loginAsSuperAdmin(page: Page): Promise<void> {
  await page.goto('/');

  // The login icon is always present in the navbar; clicking it opens
  // the modal because no token is set yet on a fresh test page.
  await page.locator('#login').click();

  // The login modal renders email/password inputs through cModal.
  await page.locator('input[autocomplete="email"]').fill(E2E_ADMIN_EMAIL);
  await page.locator('input[autocomplete="current-password"]').fill(E2E_ADMIN_PASSWORD);

  await page.locator('#loginButton').click();

  // After login, super-admin lands on /system. Wait for the page
  // container to be visible.
  await expect(page.locator('#tmxSystem')).toBeVisible({ timeout: 10_000 });
}

export async function signInViaApi(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API_BASE}/auth/signin`, {
    data: { email: E2E_ADMIN_EMAIL, password: E2E_ADMIN_PASSWORD },
  });
  if (!res.ok()) {
    throw new Error(`signInViaApi failed (${res.status()}): ${await res.text()}`);
  }
  const body = await res.json();
  if (!body?.token) throw new Error(`signInViaApi: missing token in response: ${JSON.stringify(body)}`);
  return body.token;
}
