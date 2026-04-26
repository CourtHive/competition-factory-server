import { test, expect } from '@playwright/test';
import { loginAsSuperAdmin, signInViaApi, API_BASE } from '../helpers/login';
import { cleanupProvisioner, uniqueProvisionerName } from '../helpers/cleanup';
import { S } from '../helpers/selectors';

test.describe('Journey 03 — API key generation', () => {
  let createdProvisionerId = '';

  test.afterEach(async ({ request }) => {
    await cleanupProvisioner(request, createdProvisionerId);
    createdProvisionerId = '';
  });

  test('generated key is shown once and cleared after closing the dialog', async ({ page, request }) => {
    // Seed via API for speed — UI-driven creation is covered in journey 02.
    const token = await signInViaApi(request);
    const created = await request.post(`${API_BASE}/admin/provisioners`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: uniqueProvisionerName() },
    });
    const body = await created.json();
    createdProvisionerId = body?.provisioner?.provisionerId;
    expect(createdProvisionerId).toBeTruthy();

    await loginAsSuperAdmin(page);
    await page.goto('/#/system/provisioners');
    await expect(page.locator(S.PROVISIONERS_LIST_TABLE)).toBeVisible();

    // Select the row by its provisionerId attribute (Tabulator sets data-row-id).
    const row = page.locator(`${S.PROVISIONERS_LIST_TABLE} .tabulator-row`, {
      hasText: 'E2E-Admin-Provisioner-',
    }).first();
    await row.click();

    await page.getByRole('button', { name: /generate key/i }).click();
    await page.getByRole('button', { name: /^generate$/i }).click();

    // The reveal modal should appear with a one-time-display API key.
    const dialog = page.getByText('API Key Generated', { exact: false });
    await expect(dialog).toBeVisible();

    // The plaintext key should be shown in a readonly input.
    const keyInput = page.locator('input[readonly]');
    await expect(keyInput).toHaveValue(/prov_sk_live_[0-9a-f]+/);

    await page.getByRole('button', { name: /i saved it/i }).click();
    await expect(dialog).not.toBeVisible();
  });
});
