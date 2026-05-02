/**
 * Generic per-provider catalog API. Backs Templates page (compositions,
 * tieFormats) and the Policies page (policies). Same shape per type;
 * the `:type` URL segment is one of `composition` | `tieFormat` | `policy`.
 *
 * PROVIDER_ADMIN of the target provider or SUPER_ADMIN required.
 */
import { baseApi } from './baseApi';

export type CatalogType = 'composition' | 'tieFormat' | 'policy';

export interface CatalogItemDto {
  catalogId: string;
  catalogType: CatalogType;
  name: string;
  description?: string | null;
  data: any;
  metadata?: any;
  createdAt: string;
  updatedAt: string;
}

export async function listCatalog(providerId: string, type: CatalogType) {
  return baseApi.get(`/provider/${providerId}/catalog/${type}`);
}

export async function getCatalogItem(providerId: string, type: CatalogType, catalogId: string) {
  return baseApi.get(`/provider/${providerId}/catalog/${type}/${catalogId}`);
}

export async function createCatalogItem(
  providerId: string,
  type: CatalogType,
  body: { name: string; description?: string; data: any; metadata?: any },
) {
  return baseApi.post(`/provider/${providerId}/catalog/${type}`, body);
}

export async function updateCatalogItem(
  providerId: string,
  type: CatalogType,
  catalogId: string,
  patch: { name?: string; description?: string; data?: any; metadata?: any },
) {
  return baseApi.put(`/provider/${providerId}/catalog/${type}/${catalogId}`, patch);
}

export async function deleteCatalogItem(providerId: string, type: CatalogType, catalogId: string) {
  return baseApi.delete(`/provider/${providerId}/catalog/${type}/${catalogId}`);
}
