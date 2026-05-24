import { test, expect } from '@playwright/test';
import { loginAsSuperAdmin } from '../helpers/login';
import { S } from '../helpers/selectors';

test.describe('Journey 01 — login + navigate', () => {
  test('super-admin logs in and lands on /system', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await expect(page.locator(S.TMX_SYSTEM)).toBeVisible();
  });

  test('navbar shows super-admin icons', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await expect(page.locator(S.H_SYSTEM)).toBeVisible();
    await expect(page.locator(S.H_SYNC)).toBeVisible();
    // The provisioner icon is gated for super-admins: navVisibility shows it
    // only after an active provisioner is selected (the /provisioner/* API
    // needs the X-Provisioner-Id header). Simulate that selection, then assert.
    await page.evaluate(() => {
      localStorage.setItem('admin_active_provisioner', 'e2e-active-provisioner');
      document.dispatchEvent(new CustomEvent('admin:provisioner-changed'));
    });
    await expect(page.locator(S.H_PROVISIONER)).toBeVisible();
  });

  test('clicking system icon stays on /system', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.locator(S.H_SYSTEM).click();
    await expect(page).toHaveURL(/#\/system/);
  });
});
