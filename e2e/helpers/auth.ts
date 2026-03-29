import type { Page } from '@playwright/test';

/**
 * Authenticates by calling the server login API directly and storing
 * the JWT token in localStorage (matching the admin client's auth pattern).
 */
export async function loginViaApi(
  page: Page,
  { email, password, baseUrl }: { email: string; password: string; baseUrl: string },
) {
  // Navigate to the admin page first so we have a page context for localStorage
  await page.goto('/admin/');

  // Call the login API directly
  const response = await page.request.post(`${baseUrl}/auth/login`, {
    data: { email, password },
  });

  const body = await response.json();
  const token = body?.token;

  if (!token) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(body)}`);
  }

  // Store the token in localStorage (matching admin client's auth pattern)
  await page.evaluate((jwt) => {
    localStorage.setItem('cf_admin_jwt', jwt);
  }, token);

  // Reload to pick up the token
  await page.reload();
}

/**
 * Seed test users via the API.
 * Call this in globalSetup if needed, or use existing test users.
 */
export async function seedTestUsers(baseUrl: string) {
  // This would call the auth/invite and auth endpoints to create test users.
  // For now, assume test users exist in the dev environment.
  // In CI, a seed script would create them.
  console.log(`[e2e] Using test users on ${baseUrl}`);
}
