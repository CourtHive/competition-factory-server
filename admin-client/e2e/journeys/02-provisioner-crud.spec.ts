import { test, expect } from '@playwright/test';
import { loginAsSuperAdmin, signInViaApi, API_BASE } from '../helpers/login';
import { cleanupProvisioner, uniqueProvisionerName } from '../helpers/cleanup';
import { S } from '../helpers/selectors';

test.describe('Journey 02 — provisioner create / list / delete', () => {
  let createdProvisionerId = '';
  let testName = '';

  test.beforeEach(() => {
    testName = uniqueProvisionerName();
  });

  test.afterEach(async ({ request }) => {
    await cleanupProvisioner(request, createdProvisionerId);
    createdProvisionerId = '';
  });

  test('super-admin creates a provisioner via the system page', async ({ page, request }) => {
    await loginAsSuperAdmin(page);

    await page.goto('/#/system/provisioners');
    await expect(page.locator(S.PROVISIONERS_LIST_TABLE)).toBeVisible();

    await page.getByRole('button', { name: /create provisioner/i }).click();

    // The create modal renders a single name input via renderForm.
    await page.locator('.cmodal-dialog input').first().fill(testName);
    await page.getByRole('button', { name: /^create$/i }).click();

    // The new row should appear in the list table.
    await expect(
      page.locator(S.PROVISIONERS_LIST_TABLE).getByText(testName, { exact: true }),
    ).toBeVisible({ timeout: 5_000 });

    // Locate the provisionerId via API (the UI doesn't surface UUIDs in
    // the list) so afterEach can clean it up.
    const token = await signInViaApi(request);
    const res = await request.get(`${API_BASE}/admin/provisioners`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    const created = (body?.provisioners ?? []).find((p: any) => p.name === testName);
    expect(created?.provisionerId).toBeTruthy();
    createdProvisionerId = created.provisionerId;
  });
});
