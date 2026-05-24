/**
 * Test-data fixtures for role-routing e2e (journey 06).
 *
 * All creation goes through the admin REST API as the bootstrap super-admin
 * (the same token `signInViaApi` returns). Users are made login-ready by
 * walking the real first-login flow (admin-create-user forces
 * mustChangePassword; we clear it via /auth/complete-first-login) so the test
 * can drive the login modal directly.
 *
 * Tests own cleanup: call `removeUser` / `cleanupProvisioner` in afterAll.
 */
import type { APIRequestContext } from '@playwright/test';
import { API_BASE } from './login';

export const E2E_ROLE_PASSWORD = process.env.E2E_ROLE_PASSWORD ?? 'e2e-role-password-do-not-reuse';

const authHeaders = (token: string) => ({ Authorization: `Bearer ${token}` });

export interface CreateUserOpts {
  email: string;
  password?: string;
  roles?: string[];
  providerId?: string;
  providerRole?: 'PROVIDER_ADMIN' | 'DIRECTOR';
}

/** Unique suffix so parallel/repeat runs don't collide on emails or names. */
export function uniqueSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

/** Idempotently ensure a provider with the given abbreviation exists; returns its id. */
export async function ensureProvider(
  request: APIRequestContext,
  token: string,
  organisationAbbreviation: string,
  organisationName: string,
): Promise<string> {
  const addRes = await request.post(`${API_BASE}/provider/add`, {
    headers: authHeaders(token),
    data: { organisationAbbreviation, organisationName },
  });
  const addBody = await addRes.json().catch(() => ({}));
  if (addBody?.providerId) return addBody.providerId;

  // Abbreviation already taken (or add errored) — look it up by abbreviation.
  const listRes = await request.post(`${API_BASE}/provider/allproviders`, { headers: authHeaders(token) });
  const listBody = await listRes.json();
  const match = (listBody?.providers ?? []).find(
    (p: any) => p?.value?.organisationAbbreviation === organisationAbbreviation,
  );
  const providerId = match?.value?.organisationId;
  if (!providerId) {
    throw new Error(`ensureProvider(${organisationAbbreviation}): could not create or find — ${JSON.stringify(addBody)}`);
  }
  return providerId;
}

/** Create a user that can log in immediately (clears the forced first-login change). */
export async function createLoginableUser(
  request: APIRequestContext,
  token: string,
  opts: CreateUserOpts,
): Promise<void> {
  const password = opts.password ?? E2E_ROLE_PASSWORD;
  const createRes = await request.post(`${API_BASE}/auth/admin-create-user`, {
    headers: authHeaders(token),
    data: {
      email: opts.email,
      password,
      roles: opts.roles ?? [],
      providerId: opts.providerId,
      providerRole: opts.providerRole,
    },
  });
  if (!createRes.ok()) {
    throw new Error(`admin-create-user(${opts.email}) failed (${createRes.status()}): ${await createRes.text()}`);
  }

  // admin-create-user sets mustChangePassword=true. Walk the real first-login
  // flow to clear it so the user can authenticate directly in the test.
  const loginRes = await request.post(`${API_BASE}/auth/login`, { data: { email: opts.email, password } });
  const loginBody = await loginRes.json().catch(() => ({}));
  if (loginBody?.limitedToken) {
    const completeRes = await request.post(`${API_BASE}/auth/complete-first-login`, {
      data: { limitedToken: loginBody.limitedToken, newPassword: password },
    });
    if (!completeRes.ok()) {
      throw new Error(`complete-first-login(${opts.email}) failed (${completeRes.status()}): ${await completeRes.text()}`);
    }
  }
}

/** Remove a user by email (super-admin). Safe to call for cleanup. */
export async function removeUser(request: APIRequestContext, token: string, email: string): Promise<void> {
  if (!email) return;
  await request.post(`${API_BASE}/auth/remove`, { headers: authHeaders(token), data: { email } });
}

/** Create a provisioner; returns its id. */
export async function createProvisioner(request: APIRequestContext, token: string, name: string): Promise<string> {
  const res = await request.post(`${API_BASE}/admin/provisioners`, { headers: authHeaders(token), data: { name } });
  if (!res.ok()) throw new Error(`create provisioner(${name}) failed (${res.status()}): ${await res.text()}`);
  const body = await res.json();
  const id = body?.provisionerId ?? body?.id ?? body?.provisioner?.provisionerId ?? body?.provisioner?.id;
  if (!id) throw new Error(`create provisioner(${name}): no id in ${JSON.stringify(body)}`);
  return id;
}

/** Associate a provider to a provisioner (owner by default). */
export async function associateProviderToProvisioner(
  request: APIRequestContext,
  token: string,
  provisionerId: string,
  providerId: string,
  relationship: 'owner' | 'subsidiary' = 'owner',
): Promise<void> {
  const res = await request.post(`${API_BASE}/admin/provisioners/${provisionerId}/providers`, {
    headers: authHeaders(token),
    data: { providerId, relationship },
  });
  if (!res.ok()) throw new Error(`associate provider failed (${res.status()}): ${await res.text()}`);
}

/** Assign an existing user as a representative of a provisioner (grants the PROVISIONER role). */
export async function assignProvisionerRep(
  request: APIRequestContext,
  token: string,
  provisionerId: string,
  email: string,
): Promise<void> {
  const res = await request.post(`${API_BASE}/admin/provisioners/${provisionerId}/users`, {
    headers: authHeaders(token),
    data: { email },
  });
  if (!res.ok()) throw new Error(`assign rep(${email}) failed (${res.status()}): ${await res.text()}`);
}
