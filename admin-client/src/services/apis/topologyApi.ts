/**
 * Per-provider topology catalog API.
 *
 * Topologies are bracket structures authored by provider admins via the
 * Templates page. The IDs are referenced by `allowedDrawTypes` in
 * `providerConfigSettings` so the Settings panel's Allowed Selections
 * chip widget can surface provider-defined draw structures alongside
 * the factory enum.
 *
 * All endpoints require PROVIDER_ADMIN of the target provider or
 * SUPER_ADMIN.
 */
import { baseApi } from './baseApi';

export interface TopologyDto {
  topologyId: string;
  name: string;
  description?: string | null;
  state: any;
  createdAt: string;
  updatedAt: string;
}

export async function listTopologies(providerId: string) {
  return baseApi.get(`/provider/${providerId}/topologies`);
}

export async function getTopology(providerId: string, topologyId: string) {
  return baseApi.get(`/provider/${providerId}/topologies/${topologyId}`);
}

export async function createTopology(
  providerId: string,
  body: { name: string; description?: string; state: any },
) {
  return baseApi.post(`/provider/${providerId}/topologies`, body);
}

export async function updateTopology(
  providerId: string,
  topologyId: string,
  patch: { name?: string; description?: string; state?: any },
) {
  return baseApi.put(`/provider/${providerId}/topologies/${topologyId}`, patch);
}

export async function deleteTopology(providerId: string, topologyId: string) {
  return baseApi.delete(`/provider/${providerId}/topologies/${topologyId}`);
}
