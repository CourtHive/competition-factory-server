/**
 * Write a complete export of one provider's live data to disk.
 *
 * The archive is the durable record of an archived provider. The
 * cleanup service then deletes the live rows. revive-provider.mjs reads
 * the archive back and rebuilds the live rows in a single transaction.
 *
 * Two-phase write:
 *   1. Write everything to `<archives>/<abbr>-<UTC-ts>.partial/`
 *   2. Compute manifest.json with sha256 of every payload file
 *   3. Atomic rename `.partial` → final `<abbr>-<UTC-ts>/`
 *
 * If anything fails before the rename, the `.partial` directory is left
 * in place for a human (or a future sweeper) to clean up — the live DB
 * is unmodified because the caller invokes this BEFORE the cleanup
 * transaction.
 *
 * Path resolution:
 *   ARCHIVES_PATH env (absolute path) — required in production. In
 *   dev/CI the writer falls back to `<cwd>/.archives-local/` so unit
 *   tests + local exploration work without configuration. Failing
 *   loud here would be friendlier than a silently-misplaced archive.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { Pool } from 'pg';
import fs from 'fs/promises';
import path from 'path';

import { PG_POOL } from 'src/storage/postgres/postgres.config';

export interface ArchiveManifest {
  version: 1;
  archivedAt: string;
  providerId: string;
  providerAbbr: string;
  providerName: string;
  files: Record<string, { sha256: string; bytes: number; rows?: number }>;
}

export interface ArchiveWriteResult {
  archivePath: string;
  manifestSha256: string;
  tournamentCount: number;
  userAssocCount: number;
  auditLogRows: number;
}

@Injectable()
export class ProviderArchiveService {
  private readonly logger = new Logger(ProviderArchiveService.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private resolveBasePath(): string {
    const fromEnv = process.env.ARCHIVES_PATH;
    if (fromEnv && fromEnv.trim()) return fromEnv.trim();
    const fallback = path.join(process.cwd(), '.archives-local');
    this.logger.warn(
      `ARCHIVES_PATH not set — writing to fallback ${fallback} (production deploys MUST set this env var).`,
    );
    return fallback;
  }

  /**
   * Write the archive. Returns the final (post-rename) path + the
   * sha256 of the manifest file (which itself contains sha256s of
   * each payload).
   */
  async writeArchive(provider: {
    providerId: string;
    providerAbbr: string;
    providerName: string;
  }): Promise<ArchiveWriteResult> {
    const base = this.resolveBasePath();
    await fs.mkdir(base, { recursive: true });

    const utcTs = new Date().toISOString().replace(/[:.]/g, '-');
    const finalName = `${provider.providerAbbr}-${utcTs}`;
    const partialDir = path.join(base, `${finalName}.partial`);
    const finalDir = path.join(base, finalName);

    await fs.mkdir(partialDir, { recursive: true });
    await fs.mkdir(path.join(partialDir, 'tournaments'), { recursive: true });

    const manifest: ArchiveManifest = {
      version: 1,
      archivedAt: new Date().toISOString(),
      providerId: provider.providerId,
      providerAbbr: provider.providerAbbr,
      providerName: provider.providerName,
      files: {},
    };

    // Helper: write a JSON file, compute sha256, record in manifest.
    const writeJson = async (relPath: string, payload: any, rows?: number) => {
      const json = JSON.stringify(payload, null, 2);
      const filePath = path.join(partialDir, relPath);
      await fs.writeFile(filePath, json, 'utf8');
      const sha = createHash('sha256').update(json).digest('hex');
      manifest.files[relPath] = { sha256: sha, bytes: Buffer.byteLength(json, 'utf8'), rows };
    };

    // The exported tables. Per-table queries below match the cleanup
    // service's reach (every soft-FK column we explicitly wipe gets
    // exported here first). Order is roughly dependency-friendly for
    // the revive flow: providers first, then association tables,
    // then tournaments + audit_log.
    const tablesByProviderId: Array<{ rel: string; sql: string }> = [
      { rel: 'provider.json',              sql: 'SELECT * FROM providers WHERE provider_id = $1' },
      { rel: 'user_providers.json',        sql: 'SELECT * FROM user_providers WHERE provider_id = $1' },
      { rel: 'provisioner_providers.json', sql: 'SELECT * FROM provisioner_providers WHERE provider_id = $1' },
      { rel: 'tournament_assignments.json', sql: 'SELECT * FROM tournament_assignments WHERE provider_id = $1' },
      { rel: 'official_records.json',      sql: 'SELECT * FROM official_records WHERE provider_id = $1' },
      { rel: 'tournament_provisioner.json', sql: 'SELECT * FROM tournament_provisioner WHERE provider_id = $1' },
      { rel: 'pending_saves.json',         sql: 'SELECT * FROM pending_saves WHERE provider_id = $1' },
      { rel: 'provider_topologies.json',   sql: 'SELECT * FROM provider_topologies WHERE provider_id = $1' },
      { rel: 'provider_catalog_items.json', sql: 'SELECT * FROM provider_catalog_items WHERE provider_id = $1' },
      { rel: 'policies.json',              sql: 'SELECT * FROM policies WHERE provider_id = $1' },
    ];

    for (const { rel, sql } of tablesByProviderId) {
      const result = await this.pool.query(sql, [provider.providerId]);
      await writeJson(rel, result.rows, result.rows.length);
    }

    // Sanctioning uses a differently-named column.
    const sanctioning = await this.pool.query(
      'SELECT * FROM sanctioning_records WHERE applicant_provider_id = $1',
      [provider.providerId],
    );
    await writeJson('sanctioning_records.json', sanctioning.rows, sanctioning.rows.length);

    // Calendar is keyed by abbr, not id.
    const calendars = await this.pool.query(
      'SELECT * FROM calendars WHERE provider_abbr = $1',
      [provider.providerAbbr],
    );
    await writeJson('calendar.json', calendars.rows, calendars.rows.length);

    // Tournaments — one file per record. Even for a large provider this
    // stays manageable: one JSON file per tournament, content roughly
    // equal to what the live DB already stores.
    const tournaments = await this.pool.query(
      'SELECT tournament_id, provider_id, tournament_name, start_date, end_date, data, created_at, updated_at FROM tournaments WHERE provider_id = $1',
      [provider.providerId],
    );
    const tournamentIds = tournaments.rows.map((r) => r.tournament_id);
    for (const row of tournaments.rows) {
      const rel = path.join('tournaments', `${row.tournament_id}.json`);
      await writeJson(rel, row);
    }

    // Audit log: filtered by tournament_ids. Streamed as JSONL because
    // a busy provider can have thousands of audit rows; loading them
    // into one giant JSON array would balloon memory.
    let auditCount = 0;
    if (tournamentIds.length > 0) {
      const auditResult = await this.pool.query(
        'SELECT * FROM audit_log WHERE tournament_id = ANY($1::text[]) ORDER BY occurred_at',
        [tournamentIds],
      );
      const lines = auditResult.rows.map((r) => JSON.stringify(r)).join('\n') + (auditResult.rows.length ? '\n' : '');
      const filePath = path.join(partialDir, 'audit_log.jsonl');
      await fs.writeFile(filePath, lines, 'utf8');
      const sha = createHash('sha256').update(lines).digest('hex');
      manifest.files['audit_log.jsonl'] = {
        sha256: sha,
        bytes: Buffer.byteLength(lines, 'utf8'),
        rows: auditResult.rows.length,
      };
      auditCount = auditResult.rows.length;
    } else {
      // Still write an empty file so the manifest has a consistent
      // file set regardless of whether the provider had tournaments.
      const filePath = path.join(partialDir, 'audit_log.jsonl');
      await fs.writeFile(filePath, '', 'utf8');
      const sha = createHash('sha256').update('').digest('hex');
      manifest.files['audit_log.jsonl'] = { sha256: sha, bytes: 0, rows: 0 };
    }

    // Write the manifest itself, then compute its sha256 as the
    // top-level integrity check we record in provider_archives.
    const manifestJson = JSON.stringify(manifest, null, 2);
    await fs.writeFile(path.join(partialDir, 'manifest.json'), manifestJson, 'utf8');
    const manifestSha256 = createHash('sha256').update(manifestJson).digest('hex');

    // Count user_providers from manifest (avoid a second query)
    const userAssocCount = manifest.files['user_providers.json']?.rows ?? 0;

    // Atomic rename .partial → final. If this throws, the .partial
    // directory survives for inspection / manual cleanup.
    await fs.rename(partialDir, finalDir);

    return {
      archivePath: finalDir,
      manifestSha256,
      tournamentCount: tournaments.rows.length,
      userAssocCount,
      auditLogRows: auditCount,
    };
  }
}
