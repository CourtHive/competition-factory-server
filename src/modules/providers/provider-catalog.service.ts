import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';

import {
  PROVIDER_CATALOG_STORAGE,
  type IProviderCatalogStorage,
  type CatalogItemRow,
  type CatalogType,
} from 'src/storage/interfaces/provider-catalog-storage.interface';
import { SUCCESS } from 'src/common/constants/app';

const VALID_TYPES: ReadonlyArray<CatalogType> = ['composition', 'tieFormat', 'policy'];

export interface CatalogItemDto {
  catalogId: string;
  catalogType: CatalogType;
  name: string;
  description?: string | null;
  data: any;
  metadata?: any;
  createdAt: Date;
  updatedAt: Date;
}

function toDto(row: CatalogItemRow): CatalogItemDto {
  return {
    catalogId: row.catalogId,
    catalogType: row.catalogType,
    name: row.name,
    description: row.description,
    data: row.data,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function assertCatalogType(input: string): CatalogType {
  if (!VALID_TYPES.includes(input as CatalogType)) {
    throw new NotFoundException(`Unknown catalog type: ${input}`);
  }
  return input as CatalogType;
}

@Injectable()
export class ProviderCatalogService {
  constructor(
    @Inject(PROVIDER_CATALOG_STORAGE) private readonly storage: IProviderCatalogStorage,
  ) {}

  async list(providerId: string, catalogType: CatalogType): Promise<{ items: CatalogItemDto[] }> {
    const rows = await this.storage.findByProvider(providerId, catalogType);
    return { items: rows.map(toDto) };
  }

  async getOne(
    providerId: string,
    catalogType: CatalogType,
    catalogId: string,
  ): Promise<CatalogItemDto> {
    const row = await this.storage.getOne(providerId, catalogType, catalogId);
    if (!row) throw new NotFoundException('Catalog item not found');
    return toDto(row);
  }

  async create(
    providerId: string,
    catalogType: CatalogType,
    body: { name: string; description?: string; data: any; metadata?: any },
  ): Promise<CatalogItemDto> {
    const row = await this.storage.create({
      catalogId: randomUUID(),
      providerId,
      catalogType,
      name: body.name,
      description: body.description ?? null,
      data: body.data,
      metadata: body.metadata,
    });
    return toDto(row);
  }

  async update(
    providerId: string,
    catalogType: CatalogType,
    catalogId: string,
    patch: { name?: string; description?: string; data?: any; metadata?: any },
  ) {
    const existing = await this.storage.getOne(providerId, catalogType, catalogId);
    if (!existing) throw new NotFoundException('Catalog item not found');
    await this.storage.update(providerId, catalogType, catalogId, patch);
    const updated = await this.storage.getOne(providerId, catalogType, catalogId);
    return { ...SUCCESS, item: updated ? toDto(updated) : null };
  }

  async remove(providerId: string, catalogType: CatalogType, catalogId: string) {
    return this.storage.remove(providerId, catalogType, catalogId);
  }
}
