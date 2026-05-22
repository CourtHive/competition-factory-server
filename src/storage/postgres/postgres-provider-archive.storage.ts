import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import {
  IProviderArchiveStorage,
  ProviderArchiveRow,
} from '../interfaces/provider-archive-storage.interface';
import { PG_POOL } from './postgres.config';
import { SUCCESS } from 'src/common/constants/app';

@Injectable()
export class PostgresProviderArchiveStorage implements IProviderArchiveStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private mapRow(row: any): ProviderArchiveRow {
    return {
      archiveId: row.archive_id,
      providerId: row.provider_id,
      providerAbbr: row.provider_abbr,
      providerName: row.provider_name,
      archivePath: row.archive_path,
      manifestSha256: row.manifest_sha256,
      tournamentCount: row.tournament_count,
      userAssocCount: row.user_assoc_count,
      archivedAt: row.archived_at?.toISOString?.() ?? row.archived_at,
      archivedBy: row.archived_by ?? null,
      revivedAt: row.revived_at?.toISOString?.() ?? row.revived_at ?? null,
    };
  }

  async insert(row: {
    providerId: string;
    providerAbbr: string;
    providerName: string;
    archivePath: string;
    manifestSha256: string;
    tournamentCount: number;
    userAssocCount: number;
    archivedBy: string | null;
  }): Promise<ProviderArchiveRow> {
    const result = await this.pool.query(
      `INSERT INTO provider_archives
        (provider_id, provider_abbr, provider_name, archive_path,
         manifest_sha256, tournament_count, user_assoc_count, archived_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        row.providerId,
        row.providerAbbr,
        row.providerName,
        row.archivePath,
        row.manifestSha256,
        row.tournamentCount,
        row.userAssocCount,
        row.archivedBy,
      ],
    );
    return this.mapRow(result.rows[0]);
  }

  async findById(archiveId: string): Promise<ProviderArchiveRow | null> {
    const result = await this.pool.query(
      `SELECT * FROM provider_archives WHERE archive_id = $1 LIMIT 1`,
      [archiveId],
    );
    if (!result.rows.length) return null;
    return this.mapRow(result.rows[0]);
  }

  async findByProviderId(providerId: string): Promise<ProviderArchiveRow[]> {
    const result = await this.pool.query(
      `SELECT * FROM provider_archives WHERE provider_id = $1 ORDER BY archived_at DESC`,
      [providerId],
    );
    return result.rows.map((r) => this.mapRow(r));
  }

  async markRevived(archiveId: string): Promise<{ success: boolean }> {
    await this.pool.query(
      `UPDATE provider_archives SET revived_at = NOW() WHERE archive_id = $1`,
      [archiveId],
    );
    return { ...SUCCESS };
  }
}
