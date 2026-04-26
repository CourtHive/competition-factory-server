/**
 * Test-data cleanup helpers.
 *
 * Tests that create provisioners must call `cleanupProvisioner` in
 * afterEach to avoid accumulating dev-DB cruft (the same problem that
 * left 94 E2E-Provisioner-* rows behind before the cleanup script
 * shipped).
 */
import type { APIRequestContext } from '@playwright/test';
import { signInViaApi, API_BASE } from './login';

export async function cleanupProvisioner(
  request: APIRequestContext,
  provisionerId: string,
): Promise<void> {
  if (!provisionerId) return;
  const token = await signInViaApi(request);

  // Server enforces deactivate-then-delete; do both in sequence.
  await request.put(`${API_BASE}/admin/provisioners/${provisionerId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { isActive: false },
  });

  await request.delete(`${API_BASE}/admin/provisioners/${provisionerId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** Generate a unique provisioner name for a test run. */
export function uniqueProvisionerName(prefix = 'E2E-Admin-Provisioner'): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}
