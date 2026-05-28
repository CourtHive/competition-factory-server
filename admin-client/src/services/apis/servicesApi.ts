import { baseApi } from './baseApi';

import type { ProvidersResponse, UsersResponse } from 'types/tmx';

// TODO: URL and parameters should be defined in provider specific location.  Provider-services?
export async function fetchTournamentDetails({ identifier }: { identifier: string }) {
  return await baseApi.post('/service/tournamentdetails', { identifier });
}

export async function requestTournament({ tournamentId }: { tournamentId: string }) {
  return await baseApi.post('/factory/fetch', { tournamentId });
}

export async function addProvider({ provider }: { provider: any }) {
  return await baseApi.post('/provider/add', provider);
}

export async function modifyProvider({ provider }: { provider: any }) {
  return await baseApi.post('/provider/modify', provider);
}

/**
 * Plan A — preview the blast radius of an archive/delete. Returns
 * counts for every soft-FK table that would be touched.
 * SUPER_ADMIN only.
 */
export async function previewArchiveProvider({ providerId }: { providerId: string }) {
  return await baseApi.post(`/provider/${encodeURIComponent(providerId)}/preview-archive`, {});
}

/**
 * Plan A — archive (export to disk + wipe live DB). Recoverable via
 * the backend revive-provider.mjs script. `confirm` must equal the
 * provider's organisationAbbreviation.
 */
export async function archiveProvider({
  providerId,
  confirm,
}: {
  providerId: string;
  confirm: string;
}) {
  return await baseApi.post(`/provider/${encodeURIComponent(providerId)}/archive`, { confirm });
}

/**
 * Plan A — DESTRUCTIVE delete (no export, no recovery). For demo
 * providers and the like. Requires `confirm` matching abbreviation
 * AND `acknowledgeDataLoss: true`.
 */
export async function deleteProviderPermanently({
  providerId,
  confirm,
}: {
  providerId: string;
  confirm: string;
}) {
  return await baseApi.post(`/provider/${encodeURIComponent(providerId)}/delete`, {
    confirm,
    acknowledgeDataLoss: true,
  });
}

export async function getProvider({ providerId }: { providerId: string }) {
  return await baseApi.post('/provider/detail', { providerId });
}

export async function getCalendar({ providerAbbr }: { providerAbbr: string }) {
  return await baseApi.post('/provider/calendar', { providerAbbr });
}

export async function getProviders(): Promise<ProvidersResponse> {
  return await baseApi.post('/provider/allProviders', {});
}

export async function getUsers(): Promise<UsersResponse> {
  return await baseApi.post('/auth/allusers', {});
}

export async function removeUser({ email }: { email: string }) {
  return await baseApi.post('/auth/remove', { email });
}

export async function modifyUser({
  email,
  providerId,
  roles,
  permissions,
  services,
  contactEmail,
}: {
  email: string;
  providerId?: string;
  roles: string[];
  permissions: string[];
  services: string[];
  contactEmail?: string;
}) {
  return await baseApi.post('/auth/modify', { email, providerId, roles, permissions, services, contactEmail });
}

export async function adminResendVerification({ email }: { email: string }) {
  return await baseApi.post('/account/contact-email/admin-resend', { email });
}

export interface ContactEmailCoverage {
  total: number;
  missing: number;
  equalsLogin: number;
  verified: number;
  unverified: number;
}

export async function getContactEmailCoverage() {
  return await baseApi.get('/account/contact-email/coverage');
}

export async function sendTournament({ tournamentRecord }: { tournamentRecord: any }) {
  return await baseApi.post('/factory/save', { tournamentRecord });
}

export async function removeTournament({ providerId, tournamentId }: { providerId: string; tournamentId: string }) {
  return await baseApi.post('/factory/remove', { providerId, tournamentId });
}

export async function adminResetPassword({ email, newPassword }: { email: string; newPassword?: string }) {
  return await baseApi.post('/auth/admin-reset-password', { email, newPassword });
}

// ────────────────────────────────────────────────────────────────────────────
// User-provider associations
//
// Backed by `UsersProvidersController` in competition-factory-server. The
// list endpoint returns rows scoped to the editor's authorised providers
// — super-admins see all rows, others see only rows at providers they
// administer. A 409 response from PUT/DELETE means the change would
// leave the provider with no PROVIDER_ADMIN.
// ────────────────────────────────────────────────────────────────────────────

export interface UserProviderAssociation {
  userId: string;
  providerId: string;
  providerRole: string;
  organisationName: string;
  organisationAbbreviation: string;
  email?: string;
  createdAt?: string;
  updatedAt?: string;
}

export async function listUserProviders({
  userId,
}: {
  userId: string;
}): Promise<UserProviderAssociation[]> {
  const res = await baseApi.get(`/provisioner/users/${encodeURIComponent(userId)}/providers`);
  return res?.data ?? [];
}

export async function setUserProvider({
  userId,
  providerId,
  providerRole,
}: {
  userId: string;
  providerId: string;
  providerRole: 'PROVIDER_ADMIN' | 'DIRECTOR';
}): Promise<UserProviderAssociation | null> {
  const res = await baseApi.put(
    `/provisioner/users/${encodeURIComponent(userId)}/providers/${encodeURIComponent(providerId)}`,
    { providerRole },
  );
  return res?.data ?? null;
}

export async function removeUserProvider({
  userId,
  providerId,
}: {
  userId: string;
  providerId: string;
}): Promise<{ success: boolean }> {
  const res = await baseApi.delete(
    `/provisioner/users/${encodeURIComponent(userId)}/providers/${encodeURIComponent(providerId)}`,
  );
  return res?.data ?? { success: false };
}

export async function calendarAudit({ providerAbbr }: { providerAbbr: string }) {
  return await baseApi.post('/provider/calendar-audit', { providerAbbr });
}

export async function getTournamentInfo({ tournamentId }: { tournamentId: string }) {
  return await baseApi.post('/factory/tournamentinfo', { tournamentId, withMatchUpStats: true });
}
