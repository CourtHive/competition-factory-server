/**
 * Provisioner-as-human API surface (Phase 2A.5).
 *
 * Targets the existing `/provisioner/*` endpoints. Auth happens via the
 * normal Bearer JWT (set by baseApi); the server's ProvisionerMiddleware
 * resolves req.provisioner from the JWT's provisionerIds.
 *
 * For users who represent multiple provisioners we send the active one in
 * X-Provisioner-Id. The active provisioner is held in localStorage so it
 * survives reloads.
 */
import { baseApi } from './baseApi';

const ACTIVE_PROVISIONER_KEY = 'admin_active_provisioner';

export function getActiveProvisionerId(): string | undefined {
  try {
    return globalThis.localStorage?.getItem(ACTIVE_PROVISIONER_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setActiveProvisionerId(provisionerId: string): void {
  try {
    globalThis.localStorage?.setItem(ACTIVE_PROVISIONER_KEY, provisionerId);
  } catch {
    /* non-fatal */
  }
}

export function clearActiveProvisionerId(): void {
  try {
    globalThis.localStorage?.removeItem(ACTIVE_PROVISIONER_KEY);
  } catch {
    /* non-fatal */
  }
}

function provisionerHeaders(): Record<string, string> {
  const id = getActiveProvisionerId();
  return id ? { 'X-Provisioner-Id': id } : {};
}

// ── Providers (under my provisioner) ───────────────────────────────

export async function listMyProviders() {
  return baseApi.get('/provisioner/providers', { headers: provisionerHeaders() });
}

export async function createProviderAsProvisioner(body: {
  organisationAbbreviation: string;
  organisationName: string;
  providerConfig?: Record<string, any>;
}) {
  return baseApi.post('/provisioner/providers', body, { headers: provisionerHeaders() });
}

export async function getProviderAsProvisioner(providerId: string) {
  return baseApi.get(`/provisioner/providers/${providerId}`, { headers: provisionerHeaders() });
}

export async function updateProviderAsProvisioner(
  providerId: string,
  body: { organisationName?: string; providerConfig?: Record<string, any>; inactive?: boolean },
) {
  return baseApi.put(`/provisioner/providers/${providerId}`, body, {
    headers: provisionerHeaders(),
  });
}

/**
 * Two-tier provider config: provisioner writes caps. Validator on the
 * server returns per-field issues if the body is malformed; treat any
 * response with `code: 'CAPS_INVALID'` as a validation rejection.
 */
export async function updateProviderCapsAsProvisioner(providerId: string, caps: Record<string, any>) {
  return baseApi.put(
    `/provisioner/providers/${providerId}/caps`,
    { caps },
    { headers: provisionerHeaders() },
  );
}

// ── Users (under my provisioner) ───────────────────────────────────

export async function listMyProviderUsers(providerId: string) {
  return baseApi.get(`/provisioner/users?providerId=${encodeURIComponent(providerId)}`, {
    headers: provisionerHeaders(),
  });
}

export async function createUserAsProvisioner(body: {
  providerId: string;
  externalId: string;
  email: string;
  phone?: string;
  providerRole: 'PROVIDER_ADMIN' | 'DIRECTOR';
  ssoProvider: string;
}) {
  return baseApi.post('/provisioner/users', body, { headers: provisionerHeaders() });
}
