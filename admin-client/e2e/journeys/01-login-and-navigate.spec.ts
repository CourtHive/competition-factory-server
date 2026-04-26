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
    await expect(page.locator(S.H_PROVISIONER)).toBeVisible();
    await expect(page.locator(S.H_SYNC)).toBeVisible();
  });

  test('clicking system icon stays on /system', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.locator(S.H_SYSTEM).click();
    await expect(page).toHaveURL(/#\/system/);
  });
});
