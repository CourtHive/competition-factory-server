import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import {
  CatalogItemRow,
  CatalogType,
  IProviderCatalogStorage,
} from '../interfaces/provider-catalog-storage.interface';
import { PG_POOL } from './postgres.config';
import { SUCCESS } from 'src/common/constants/app';

const COLS =
  'catalog_id, provider_id, catalog_type, name, description, data, metadata, created_at, updated_at';

@Injectable()
export class PostgresProviderCatalogStorage implements IProviderCatalogStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findByProvider(providerId: string, catalogType: CatalogType): Promise<CatalogItemRow[]> {
    const result = await this.pool.query(
      `SELECT ${COLS} FROM provider_catalog_items
       WHERE provider_id = $1 AND catalog_type = $2
       ORDER BY name`,
      [providerId, catalogType],
    );
    return result.rows.map(mapRow);
  }

  async getOne(
    providerId: string,
    catalogType: CatalogType,
    catalogId: string,
  ): Promise<CatalogItemRow | null> {
    const result = await this.pool.query(
      `SELECT ${COLS} FROM provider_catalog_items
       WHERE provider_id = $1 AND catalog_type = $2 AND catalog_id = $3`,
      [providerId, catalogType, catalogId],
    );
    return result.rows.length ? mapRow(result.rows[0]) : null;
  }

  async create(row: Omit<CatalogItemRow, 'createdAt' | 'updatedAt'>): Promise<CatalogItemRow> {
    const result = await this.pool.query(
      `INSERT INTO provider_catalog_items
         (catalog_id, provider_id, catalog_type, name, description, data, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${COLS}`,
      [
        row.catalogId,
        row.providerId,
        row.catalogType,
        row.name,
        row.description ?? null,
        JSON.stringify(row.data),
        row.metadata != null ? JSON.stringify(row.metadata) : null,
      ],
    );
    return mapRow(result.rows[0]);
  }

  async update(
    providerId: string,
    catalogType: CatalogType,
    catalogId: string,
    patch: Partial<Pick<CatalogItemRow, 'name' | 'description' | 'data' | 'metadata'>>,
  ): Promise<{ success: boolean }> {
    const sets: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (patch.name !== undefined) {
      sets.push(`name = $${idx++}`);
      values.push(patch.name);
    }
    if (patch.description !== undefined) {
      sets.push(`description = $${idx++}`);
      values.push(patch.description);
    }
    if (patch.data !== undefined) {
      sets.push(`data = $${idx++}`);
      values.push(JSON.stringify(patch.data));
    }
    if (patch.metadata !== undefined) {
      sets.push(`metadata = $${idx++}`);
      values.push(patch.metadata != null ? JSON.stringify(patch.metadata) : null);
    }

    if (!sets.length) return { ...SUCCESS };

    sets.push('updated_at = NOW()');
    values.push(providerId, catalogType, catalogId);

    await this.pool.query(
      `UPDATE provider_catalog_items SET ${sets.join(', ')}
       WHERE provider_id = $${idx++} AND catalog_type = $${idx++} AND catalog_id = $${idx}`,
      values,
    );
    return { ...SUCCESS };
  }

  async remove(
    providerId: string,
    catalogType: CatalogType,
    catalogId: string,
  ): Promise<{ success: boolean }> {
    await this.pool.query(
      `DELETE FROM provider_catalog_items
       WHERE provider_id = $1 AND catalog_type = $2 AND catalog_id = $3`,
      [providerId, catalogType, catalogId],
    );
    return { ...SUCCESS };
  }
}

function mapRow(row: any): CatalogItemRow {
  return {
    catalogId: row.catalog_id,
    providerId: row.provider_id,
    catalogType: row.catalog_type as CatalogType,
    name: row.name,
    description: row.description,
    data: row.data,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
