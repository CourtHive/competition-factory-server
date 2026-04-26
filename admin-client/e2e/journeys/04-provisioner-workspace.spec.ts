import { test, expect } from '@playwright/test';
import { loginAsSuperAdmin } from '../helpers/login';
import { S } from '../helpers/selectors';

/**
 * Phase 2A.5 smoke test — super-admin can preview the provisioner workspace.
 *
 * A full PROVISIONER-role login journey requires seeding a non-super-admin
 * user with the PROVISIONER role and a user_provisioners association, plus
 * generating their JWT. That setup is heavier than this scaffold should
 * enforce; for now we cover that super-admins can navigate to /provisioner
 * and see the workspace shell without errors.
 */
test.describe('Journey 04 — provisioner workspace shell', () => {
  test('super-admin can navigate to /provisioner and see the My Providers panel', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto('/#/provisioner');
    await expect(page.locator(S.TMX_PROVISIONER)).toBeVisible();
    await expect(page.locator(S.PROVISIONER_PROVIDERS_TABLE)).toBeVisible({ timeout: 5_000 });
  });

  test('switching to Users sub-tab updates the URL', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto('/#/provisioner/providers');
    await expect(page.locator(S.PROVISIONER_PROVIDERS_TABLE)).toBeVisible();

    await page.getByRole('button', { name: /^users$/i }).click();
    await expect(page).toHaveURL(/#\/provisioner\/users/);
  });
});
