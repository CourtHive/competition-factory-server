/**
 * Provider config (two-tier) API surface for the JWT-authenticated paths.
 *
 *   - GET  /provider/:id/effective-config   any user with provider access
 *   - PUT  /provider/:id/settings           PROVIDER_ADMIN of the target
 *                                           provider OR SUPER_ADMIN
 *
 * The provisioner-side caps PUT lives in `provisionerWorkspaceApi.ts`
 * because it uses the X-Provisioner-Id header convention.
 */
import { baseApi } from './baseApi';

export async function getEffectiveProviderConfig(providerId: string) {
  return baseApi.get(`/provider/${providerId}/effective-config`);
}

/**
 * Provider-admin only: returns `{ caps, settings }` separately so the
 * Settings editor can render cap-aware UI. PROVIDER_ADMIN or SUPER_ADMIN
 * required server-side.
 */
export async function getRawProviderConfig(providerId: string) {
  return baseApi.get(`/provider/${providerId}/raw-config`);
}

export async function updateProviderSettings(providerId: string, settings: Record<string, any>) {
  return baseApi.put(`/provider/${providerId}/settings`, { settings });
}
