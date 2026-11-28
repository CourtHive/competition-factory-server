import { defined } from '../../tests/helpers/defined';
import { fetchQueryRecords } from '../factory/helpers/fetchQueryRecords';
import { recordRevision } from 'src/storage/postgres/recordRevision';
import { queryTournamentRecords } from '../factory/functions/private/queryTournamentRecords';
import { PostgresTournamentStorage } from 'src/storage/postgres/postgres-tournament.storage';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import asyncGlobalState from '../factory/engines/asyncGlobalState';
import { OperatorMatchService } from './operator-match.service';
import { ForbiddenException } from '@nestjs/common';
import { mocksEngine } from 'tods-competition-factory';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { vi } from 'vitest';
import { Pool } from 'pg';

describe.skipIf(process.env.STORAGE_LAYOUT_DB_TESTS !== 'true')('physical factory and operator read routes', () => {
  const schema = 'operator_read_' + randomUUID().replace(/-/g, '');
  let pool: Pool;
  let physical: PostgresTournamentStorage;
  let ordinary: PostgresTournamentStorage;
  const user = {
    userId: 'u',
    email: 'u@example.test',
    isSuperAdmin: false,
    globalRoles: [],
    providerIds: ['p'],
    providerRoles: {},
    actingProviderId: 'p',
  };
  let structureId: string;
  let ids: { tournamentId: string; eventId: string; drawId: string; matchUpId: string };
  beforeAll(async () => {
    pool = new Pool({
      host: process.env.PG_HOST || 'localhost',
      port: Number(process.env.PG_PORT) || 5432,
      user: process.env.PG_USER || process.env.USER,
      password: process.env.PG_PASSWORD || '',
      database: process.env.PG_DATABASE || 'courthive',
      options: '-c search_path=' + schema,
    });
    await pool.query('CREATE SCHEMA ' + schema);
    const dir = join(__dirname, '../../storage/postgres');
    for (const file of [
      'migrations/001-initial-schema.sql',
      'migrations/042-add-tournament-owner-epoch.sql',
      'migrations/061-tournament-storage-layout.sql',
      'migrations/062-tournament-shards.sql',
      '../../scripts/sharding/enable-record-sharding.sql',
    ]) {
      await pool.query(readFileSync(join(dir, file), 'utf8'));
    }
    const { tournamentRecord } = asyncGlobalState.runWithInstanceState(() =>
      mocksEngine.generateTournamentRecord({
        drawProfiles: [{ drawSize: 4 }, { drawSize: 4 }],
        tournamentAttributes: { tournamentId: 't' },
      }),
    );
    tournamentRecord.parentOrganisation = { organisationId: 'p', organisationName: 'p', organisationAbbreviation: 'p' };
    const event = defined(tournamentRecord.events)[0],
      draw = defined(event.drawDefinitions)[0];
    structureId = defined(draw.structures)[0].structureId;
    ids = {
      tournamentId: tournamentRecord.tournamentId,
      eventId: event.eventId,
      drawId: draw.drawId,
      matchUpId: defined(defined(draw.structures)[0].matchUps)[0].matchUpId,
    };
    try {
      vi.stubEnv('CFS_PHYSICAL_FOOTPRINT_TOURNAMENT_IDS', ' , ' + ids.tournamentId + ', ' + ids.tournamentId + ' , ');
      vi.stubEnv('CFS_PHYSICAL_FOOTPRINT_READS', 'false');
      ordinary = new PostgresTournamentStorage(pool);
      vi.stubEnv('CFS_PHYSICAL_FOOTPRINT_READS', 'true');
      physical = new PostgresTournamentStorage(pool);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(await ordinary.saveTournamentRecord({ tournamentRecord })).toMatchObject({ success: true });
    await pool.query("SELECT set_tournament_storage_layout($1,'sharded')", [ids.tournamentId]);
  });
  afterAll(async () => {
    try {
      await pool.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
    } finally {
      await pool.end();
    }
  });

  it('runs both declared generic action queries using shards and keeps the operator route on the whole record', async () => {
    expect(ordinary.readerForTournament(ids.tournamentId)).toBeUndefined();
    expect(physical.readerForTournament(ids.tournamentId)).toEqual(expect.any(Function));
    const full = vi.spyOn(physical, 'fetchTournamentRecords');
    const query = { tournamentId: ids.tournamentId, method: 'matchUpActions', params: ids };
    const expected = await queryTournamentRecords(query, ordinary);
    expect(expected.error).toBeUndefined();
    expect(await queryTournamentRecords(query, physical)).toEqual(expected);
    const position = {
      tournamentId: ids.tournamentId,
      method: 'positionActions',
      params: { ...ids, structureId, drawPosition: 1 },
    };
    const positions = await queryTournamentRecords(position, ordinary);
    expect(positions.error).toBeUndefined();
    expect(await queryTournamentRecords(position, physical)).toEqual(positions);
    expect(full).not.toHaveBeenCalled();
    const grant = {
      userId: 'u',
      providerId: 'p',
      tournamentId: ids.tournamentId,
      capability: 'canEnterScores',
      scope: { drawIds: [ids.drawId] },
    };
    const grants = { findForSubject: vi.fn().mockResolvedValue([grant]) },
      authorization = { gate: vi.fn().mockResolvedValue(null) };
    const service = (storage: PostgresTournamentStorage) =>
      new OperatorMatchService(
        {} as never,
        new TournamentStorageService(storage, {} as never, {} as never, {} as never, {} as never),
        authorization as never,
        grants as never,
      );
    const old = service(ordinary),
      next = service(physical);
    // Compute availability from the installed factory. 7.47 exposes canonical actions, but no operatorMatch DTO.
    const canonical = await queryTournamentRecords(
      { ...query, params: { ...ids, operatorAudience: 'recorder' } },
      ordinary,
    );
    if (canonical.operatorMatch) {
      const baseline = await old.read(ids, user);
      expect(baseline.match).toEqual(canonical.operatorMatch);
      expect(baseline.revision).toHaveLength(43);
      expect(await next.read(ids, user)).toEqual(baseline);
    } else {
      const unavailable = { status: 503, message: 'Operator query unavailable' };
      await expect(old.read(ids, user)).rejects.toMatchObject(unavailable);
      await expect(next.read(ids, user)).rejects.toMatchObject(unavailable);
    }
    grants.findForSubject.mockResolvedValueOnce([{ ...grant, scope: { drawIds: ['other'] } }]);
    await expect(next.read(ids, user)).rejects.toBeInstanceOf(ForbiddenException);
    expect(full.mock.calls).toEqual(
      Array.from({ length: 2 }, () => [{ tournamentId: ids.tournamentId, captureRevision: true }]),
    );
  });

  it('selects the physical authorization shell only for an opted-in singleton', async () => {
    const id = ids.tournamentId;
    const expected = await ordinary.fetchTournamentMetadata([id]);
    expect(expected).toMatchObject([{ tournamentId: id, providerId: 'p' }]);
    const calls = vi.spyOn(pool, 'query');
    try {
      expect(await physical.fetchTournamentMetadata([id])).toEqual(expected);
      expect(calls).toHaveBeenCalledTimes(1);
      expect(calls.mock.calls[0][0]).toContain('JOIN tournament_shells');
      calls.mockClear();
      expect(await physical.fetchTournamentMetadata([id, id])).toEqual(expected);
      expect(calls).toHaveBeenCalledTimes(1);
      expect(calls.mock.calls[0][0]).toContain('tournament_shell(tournament_id, data)');
      calls.mockClear();
      expect(await ordinary.fetchTournamentMetadata([id])).toEqual(expected);
      expect(calls).toHaveBeenCalledTimes(1);
      expect(calls.mock.calls[0][0]).toContain('tournament_shell(tournament_id, data)');
    } finally {
      calls.mockRestore();
    }
  });

  it('issues only ordinary SQL for an unlisted tournament or an empty allowlist', async () => {
    const unlisted = 'unlisted';
    await ordinary.saveTournamentRecord({
      tournamentRecord: { tournamentId: unlisted, parentOrganisation: { organisationId: 'p' } },
    });
    const calls = vi.spyOn(pool, 'query');
    try {
      vi.stubEnv('CFS_PHYSICAL_FOOTPRINT_READS', 'true');
      vi.stubEnv('CFS_PHYSICAL_FOOTPRINT_TOURNAMENT_IDS', ' , ');
      const empty = new PostgresTournamentStorage(pool);
      for (const [id, adapter] of [
        [ids.tournamentId, empty],
        [unlisted, physical],
      ] as const) {
        expect(adapter.readerForTournament(id)).toBeUndefined();
        calls.mockClear();
        const got = await fetchQueryRecords(adapter, { tournamentId: id }, 'matchUpActions', {
          ...ids,
          tournamentId: id,
        });
        expect(got.tournamentRecords?.[id]?.tournamentId).toEqual(id);
        expect(calls).toHaveBeenCalledTimes(1);
        expect(calls.mock.calls[0][0]).toContain('tournament_document(tournament_id, data)');
        calls.mockClear();
        expect(await adapter.fetchTournamentMetadata([id])).toMatchObject([{ tournamentId: id, providerId: 'p' }]);
        expect(calls).toHaveBeenCalledTimes(1);
        expect(calls.mock.calls[0][0]).toContain('tournament_shell(tournament_id, data)');
      }
    } finally {
      calls.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('binds the same opaque full and physical revisions to the parent snapshot even across equal-time writes', async () => {
    const fetch = { tournamentId: ids.tournamentId, captureRevision: true };
    const revisions = async () => {
      const result = await fetchQueryRecords(physical, fetch, 'matchUpActions', ids);
      expect(result.loadedFootprint).toBeDefined();
      const token = recordRevision(result.tournamentRecords![ids.tournamentId]);
      const full = await ordinary.fetchTournamentRecords(fetch);
      if (!('tournamentRecords' in full)) throw new Error('Missing whole-record revision control');
      expect(token).toHaveLength(43);
      expect(token).toBe(recordRevision(full.tournamentRecords[ids.tournamentId]));
      expect(result.serverUpdatedAt).toEqual(full.serverUpdatedAt);
      return { token, stamp: result.serverUpdatedAt };
    };
    const before = await revisions();
    await pool.query('UPDATE tournaments SET updated_at=updated_at WHERE tournament_id=$1', [ids.tournamentId]);
    const after = await revisions();
    expect(after.stamp).toEqual(before.stamp);
    expect(after.token).not.toEqual(before.token);
  });
});
