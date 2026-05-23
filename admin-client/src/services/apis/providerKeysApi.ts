import { baseApi } from './baseApi';

export interface ProviderKey {
  keyId: string;
  label?: string;
  prefix: string;
  createdAt?: string;
  expiresAt?: string;
  lastUsedAt?: string;
  isActive: boolean;
}

export interface GeneratedProviderKey {
  success: boolean;
  keyId: string;
  apiKey: string;
  label?: string;
  createdAt?: string;
}

export async function listProviderKeys(providerId: string) {
  return baseApi.get(`/admin/providers/${encodeURIComponent(providerId)}/keys`);
}

export async function generateProviderKey(providerId: string, label?: string) {
  return baseApi.post(`/admin/providers/${encodeURIComponent(providerId)}/keys`, { label });
}

export async function revokeProviderKey(providerId: string, keyId: string) {
  return baseApi.delete(
    `/admin/providers/${encodeURIComponent(providerId)}/keys/${encodeURIComponent(keyId)}`,
  );
}
