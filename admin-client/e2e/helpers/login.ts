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
// Use 127.0.0.1 not localhost — Node resolves localhost to ::1 (IPv6) first
// and the NestJS server typically only binds to IPv4, causing ECONNREFUSED.
export const API_BASE = process.env.E2E_API_BASE ?? 'http://127.0.0.1:8383';

// Backwards-compat aliases for the original symbol names
export const SUPER_ADMIN_EMAIL = E2E_ADMIN_EMAIL;
export const SUPER_ADMIN_PASSWORD = E2E_ADMIN_PASSWORD;

export async function loginAsSuperAdmin(page: Page): Promise<void> {
  // Empty path so Playwright uses the full baseURL (which already
  // includes the /admin/ base). page.goto('/') would strip /admin/
  // and hit a Vite 404.
  await page.goto('');

  // The login icon is always present in the navbar; clicking it opens
  // the modal because no token is set yet on a fresh test page.
  await page.locator('#login').click();

  // Fields have stable IDs assigned in loginModal.ts via renderForm.
  await page.locator('#loginEmail').fill(E2E_ADMIN_EMAIL);
  await page.locator('#loginPassword').fill(E2E_ADMIN_PASSWORD);

  await page.locator('#loginButton').click();

  // After login, super-admin lands on /system. Wait for the page
  // container to be visible.
  await expect(page.locator('#tmxSystem')).toBeVisible({ timeout: 10_000 });
}

export async function signInViaApi(request: APIRequestContext): Promise<string> {
  return signInAs(request, E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD);
}

/** API login as an arbitrary user; returns the JWT. */
export async function signInAs(request: APIRequestContext, email: string, password: string): Promise<string> {
  const res = await request.post(`${API_BASE}/auth/login`, { data: { email, password } });
  if (!res.ok()) {
    throw new Error(`signInAs(${email}) failed (${res.status()}): ${await res.text()}`);
  }
  const body = await res.json();
  if (!body?.token) throw new Error(`signInAs(${email}): missing token in response: ${JSON.stringify(body)}`);
  return body.token;
}

/**
 * UI login as an arbitrary user via the login modal. Does NOT assert a landing
 * page (it varies by role) — the caller asserts the resulting route/container.
 * Resolves once the modal has closed (token set + post-login navigation fired).
 */
export async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('');
  await page.locator('#login').click();
  await page.locator('#loginEmail').fill(email);
  await page.locator('#loginPassword').fill(password);
  // The login button is `close: true` — the modal closes synchronously on click
  // while sign-in runs async. Wait for the /auth/login response AND the token to
  // land so the caller can reliably assert the role-based landing / deep-link.
  const loginResponse = page.waitForResponse(
    (r) => r.url().includes('/auth/login') && r.request().method() === 'POST',
    { timeout: 15_000 },
  );
  await page.locator('#loginButton').click();
  await loginResponse;
  await page.waitForFunction(() => !!localStorage.getItem('tmxToken'), null, { timeout: 10_000 });
}
