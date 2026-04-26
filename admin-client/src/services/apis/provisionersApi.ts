import { baseApi } from './baseApi';

export interface Provisioner {
  provisionerId: string;
  name: string;
  isActive: boolean;
  config?: Record<string, any>;
  createdAt?: string;
  providerCount?: number;
  keyCount?: number;
}

export interface ProvisionerKey {
  keyId: string;
  label?: string;
  prefix: string;
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface ProvisionerProviderAssociation {
  providerId: string;
  organisationName?: string;
  organisationAbbreviation?: string;
  relationship: 'owner' | 'subsidiary';
  associatedAt?: string;
}

export async function listProvisioners() {
  return baseApi.get('/admin/provisioners');
}

export async function getProvisioner(id: string) {
  return baseApi.get(`/admin/provisioners/${id}`);
}

export async function createProvisioner(body: { name: string; config?: Record<string, any> }) {
  return baseApi.post('/admin/provisioners', body);
}

export async function updateProvisioner(id: string, body: { name?: string; isActive?: boolean; config?: Record<string, any> }) {
  return baseApi.put(`/admin/provisioners/${id}`, body);
}

export async function listProvisionerKeys(id: string) {
  return baseApi.get(`/admin/provisioners/${id}/keys`);
}

export async function generateProvisionerKey(id: string, label?: string) {
  return baseApi.post(`/admin/provisioners/${id}/keys`, { label });
}

export async function revokeProvisionerKey(id: string, keyId: string) {
  return baseApi.delete(`/admin/provisioners/${id}/keys/${keyId}`);
}

export async function listProvisionerProviders(id: string) {
  return baseApi.get(`/admin/provisioners/${id}/providers`);
}

export async function associateProviderWithProvisioner(
  id: string,
  body: { providerId: string; relationship: 'owner' | 'subsidiary' },
) {
  return baseApi.post(`/admin/provisioners/${id}/providers`, body);
}

export async function disassociateProviderFromProvisioner(id: string, providerId: string) {
  return baseApi.delete(`/admin/provisioners/${id}/providers/${providerId}`);
}
