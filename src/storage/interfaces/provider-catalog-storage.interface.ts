export const PROVIDER_CATALOG_STORAGE = Symbol('PROVIDER_CATALOG_STORAGE');

export type CatalogType = 'composition' | 'tieFormat' | 'policy';

export interface CatalogItemRow {
  catalogId: string;
  providerId: string;
  catalogType: CatalogType;
  name: string;
  description?: string | null;
  data: any;
  metadata?: any;
  createdAt: Date;
  updatedAt: Date;
}

export interface IProviderCatalogStorage {
  /** List all catalog items of `catalogType` authored by `providerId`. */
  findByProvider(providerId: string, catalogType: CatalogType): Promise<CatalogItemRow[]>;

  /** Get one item, scoped to (provider, type) so the request handler can't accidentally read another provider's row. */
  getOne(
    providerId: string,
    catalogType: CatalogType,
    catalogId: string,
  ): Promise<CatalogItemRow | null>;

  create(row: Omit<CatalogItemRow, 'createdAt' | 'updatedAt'>): Promise<CatalogItemRow>;

  update(
    providerId: string,
    catalogType: CatalogType,
    catalogId: string,
    patch: Partial<Pick<CatalogItemRow, 'name' | 'description' | 'data' | 'metadata'>>,
  ): Promise<{ success: boolean }>;

  remove(
    providerId: string,
    catalogType: CatalogType,
    catalogId: string,
  ): Promise<{ success: boolean }>;
}
