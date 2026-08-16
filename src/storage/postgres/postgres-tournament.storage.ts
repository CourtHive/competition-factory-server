import { FENCED_BY_NEWER_OWNER, SUCCESS } from 'src/common/constants/app';
import { ITournamentStorage } from '../interfaces/tournament-storage.interface';
import { getTournamentRecords } from 'src/helpers/getTournamentRecords';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { factoryConstants } from 'tods-competition-factory';
import { PG_POOL } from './postgres.config';
import { Pool } from 'pg';

@Injectable()
export class PostgresTournamentStorage implements ITournamentStorage {
  private readonly logger = new Logger(PostgresTournamentStorage.name);

  // Per-tournament fence-rejection counter, driving the A2 throttled-log
  // milestones (1, 10, 100, 1000, then every 50th) and the recovery WARN.
  //
  // A4 — resets on restart, DELIBERATELY. Unlike the audit failure counters
  // (where a reset masks a chronic failure as a first failure), re-emitting the
  // loud line after a restart is the behaviour we want here: a fence rejection
  // means this process was deposed as owner while holding a record, which is
  // never routine and always warrants investigation. The map is empty in normal
  // operation — entries are created only by a rejection and dropped on recovery.
  private readonly fenceRejections = new Map<string, number>();

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findTournamentRecord({ tournamentId }: { tournamentId: string }) {
    const result = await this.pool.query('SELECT data FROM tournaments WHERE tournament_id = $1', [tournamentId]);
    if (!result.rows.length) return { error: 'Tournament not found' };
    return { tournamentRecord: result.rows[0].data };
  }

  async fetchTournamentRecords(params: { tournamentIds?: string[]; tournamentId?: string }) {
    if (!params) return { error: { message: 'No params provided' } };

    const tournamentIds =
      (params?.tournamentIds?.length && params.tournamentIds) || [params?.tournamentId].filter(Boolean);

    if (!tournamentIds.length) {
      return { error: factoryConstants.errorConditionConstants.MISSING_TOURNAMENT_RECORD };
    }

    const result = await this.pool.query(
      'SELECT tournament_id, data FROM tournaments WHERE tournament_id = ANY($1)',
      [tournamentIds],
    );

    const tournamentRecords: Record<string, any> = {};
    for (const row of result.rows) {
      tournamentRecords[row.tournament_id] = row.data;
    }

    const fetched = result.rows.length;
    const notFound = tournamentIds.length - fetched;

    if (!fetched) return { error: factoryConstants.errorConditionConstants.MISSING_TOURNAMENT_RECORD };

    return { ...SUCCESS, tournamentRecords, fetched, notFound };
  }

  async fetchTournamentUpdatedAt({ tournamentId }: { tournamentId?: string }) {
    if (!tournamentId) {
      return { error: factoryConstants.errorConditionConstants.MISSING_TOURNAMENT_RECORD };
    }

    // Project only the few fields needed — Postgres extracts them server-side so
    // the full `data` JSONB blob is never transferred.
    const result = await this.pool.query(
      `SELECT tournament_id,
              data->>'updatedAt' AS updated_at,
              data->'parentOrganisation'->>'organisationId' AS provider_id,
              data->'extensions' AS extensions
         FROM tournaments
        WHERE tournament_id = $1`,
      [tournamentId],
    );

    if (!result.rows.length) {
      return { error: factoryConstants.errorConditionConstants.MISSING_TOURNAMENT_RECORD };
    }

    const row = result.rows[0];
    return {
      ...SUCCESS,
      tournamentId: row.tournament_id,
      updatedAt: row.updated_at,
      providerId: row.provider_id,
      extensions: row.extensions ?? [],
    };
  }

  /**
   * Persist one tournament record, guarded by the `owner_epoch` fencing token.
   *
   * The `WHERE tournaments.owner_epoch <= EXCLUDED.owner_epoch` clause on the
   * DO UPDATE branch is the entire safety mechanism: a writer deposed by an
   * ownership handoff carries a lower epoch than the row and affects zero rows,
   * atomically, without needing to know it was deposed. `rowCount === 0` on a
   * conflict therefore means FENCED, not "nothing to do".
   *
   * `ownerEpoch` defaults to 0 rather than being optional-and-bypassed (A3):
   * there is no code path in which a missing epoch permits an unguarded write.
   */
  async saveTournamentRecord({ tournamentRecord, ownerEpoch = 0 }: { tournamentRecord: any; ownerEpoch?: number }) {
    const key = tournamentRecord?.tournamentId;
    if (!key) return { error: 'Invalid tournamentRecord' };

    const providerId = tournamentRecord.parentOrganisation?.organisationId ?? null;
    const tournamentName = tournamentRecord.tournamentName ?? null;
    const startDate = tournamentRecord.startDate ?? null;
    const endDate = tournamentRecord.endDate ?? null;

    // Serialised once here and its length returned to the caller. The byte size
    // of the document is the central measurement for the load profile (Stage 0)
    // — re-stringifying to measure it would double the exact cost being
    // measured, which is self-defeating for a performance instrument.
    const serialized = JSON.stringify(tournamentRecord);

    const result = await this.pool.query(
      `INSERT INTO tournaments (tournament_id, provider_id, tournament_name, start_date, end_date, data, owner_epoch, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (tournament_id) DO UPDATE SET
         provider_id = EXCLUDED.provider_id,
         tournament_name = EXCLUDED.tournament_name,
         start_date = EXCLUDED.start_date,
         end_date = EXCLUDED.end_date,
         data = EXCLUDED.data,
         owner_epoch = EXCLUDED.owner_epoch,
         updated_at = NOW()
       WHERE tournaments.owner_epoch <= EXCLUDED.owner_epoch`,
      [key, providerId, tournamentName, startDate, endDate, serialized, ownerEpoch],
    );

    if (!result.rowCount) return this.recordFenceRejection(key, ownerEpoch);

    this.recordFenceRecovery(key);
    return { ...SUCCESS, bytes: serialized.length };
  }

  /**
   * A2 — a fence rejection must never be a silent no-op. Counts per tournament,
   * emits ERROR at milestones and DEBUG between them, and returns the distinct
   * FENCED error so callers can tell "you were deposed" (discard and
   * re-resolve) from "the write failed" (retryable).
   */
  private recordFenceRejection(tournamentId: string, ownerEpoch: number) {
    const count = (this.fenceRejections.get(tournamentId) ?? 0) + 1;
    this.fenceRejections.set(tournamentId, count);

    const isMilestone = count === 1 || count === 10 || count === 100 || count === 1000 || count % 50 === 0;
    const message =
      `FENCED (${count}x): save for tournament ${tournamentId} rejected — this process holds epoch ` +
      `${ownerEpoch} but the row has advanced beyond it. The in-hand record is stale; it must be ` +
      `discarded, not retried.`;
    if (isMilestone) this.logger.error(message);
    else this.logger.debug(message);

    return { error: FENCED_BY_NEWER_OWNER, fenced: true, tournamentId };
  }

  /** A2 — surface the first success after one or more fence rejections. */
  private recordFenceRecovery(tournamentId: string): void {
    const previous = this.fenceRejections.get(tournamentId);
    if (!previous) return;
    this.fenceRejections.delete(tournamentId);
    this.logger.warn(`Fenced writes for tournament ${tournamentId} recovered after ${previous} rejection(s)`);
  }

  async saveTournamentRecords(params: {
    tournamentRecords?: Record<string, any>;
    tournamentRecord?: any;
    ownerEpoch?: number;
  }) {
    const tournamentRecords = getTournamentRecords(params);
    const bytes: Record<string, number> = {};

    for (const tournamentId of Object.keys(tournamentRecords)) {
      const result: any = await this.saveTournamentRecord({
        tournamentRecord: tournamentRecords[tournamentId],
        ownerEpoch: params?.ownerEpoch,
      });
      if (result.error) return result;
      bytes[tournamentId] = result.bytes ?? 0;
    }

    return { ...SUCCESS, bytes };
  }

  async removeTournamentRecords(params: { tournamentIds?: string[]; tournamentId?: string }) {
    const tournamentIds = params?.tournamentIds ?? [params?.tournamentId].filter(Boolean);

    const result = await this.pool.query(
      'DELETE FROM tournaments WHERE tournament_id = ANY($1)',
      [tournamentIds],
    );

    return { ...SUCCESS, removed: result.rowCount ?? 0 };
  }

  async archiveTournamentRecord({
    tournamentRecord,
    deletedByUserId,
    deletedByEmail,
  }: {
    tournamentRecord: any;
    deletedByUserId?: string;
    deletedByEmail?: string;
  }) {
    const key = tournamentRecord?.tournamentId;
    if (!key) return { error: 'Invalid tournamentRecord' };

    const providerId = tournamentRecord.parentOrganisation?.organisationId ?? null;
    const tournamentName = tournamentRecord.tournamentName ?? null;
    const startDate = tournamentRecord.startDate ?? null;
    const endDate = tournamentRecord.endDate ?? null;

    await this.pool.query(
      `INSERT INTO deleted_tournaments
         (tournament_id, provider_id, tournament_name, start_date, end_date, data, deleted_by_user_id, deleted_by_email)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [key, providerId, tournamentName, startDate, endDate, JSON.stringify(tournamentRecord), deletedByUserId ?? null, deletedByEmail ?? null],
    );

    return { ...SUCCESS };
  }

  async listTournamentIds(): Promise<string[]> {
    const result = await this.pool.query('SELECT tournament_id FROM tournaments ORDER BY tournament_id');
    return result.rows.map((row) => row.tournament_id);
  }
}
