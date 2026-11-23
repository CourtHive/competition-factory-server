import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { getPostgresConfig } from '../../storage/postgres/postgres.config';
import { mocksEngine, tournamentEngine, tools } from 'tods-competition-factory';
import { getCompetitionScheduleMatchUps } from '../factory/functions/public/getCompetitionScheduleMatchUps';
import { queryTournamentRecords } from '../factory/functions/private/queryTournamentRecords';
import { warmEventDataCache } from '../factory/functions/private/warmEventDataCache';
import { PostgresTournamentStorage } from '../../storage/postgres/postgres-tournament.storage';
import { markRecordRevision, recordRevision } from '../../storage/postgres/recordRevision';
import { FactoryHttpDelivery } from '../factory/factory-http-delivery.service';
import { CommandReceipts } from '../../storage/postgres/commandReceipts';
import { executionQueue } from '../factory/functions/private/executionQueue';
import { getEventData } from '../factory/functions/public/getEventData';
import { operatorScorePrecondition } from '../operator/scoreRequest';
import { OperatorMatchService } from '../operator/operator-match.service';

const observation = vi.hoisted(() => ({ enabled: true, observeAccess: vi.fn(), observeCommit: vi.fn() }));
vi.mock('./footprintLocality', () => ({
  get footprintLocality() {
    return observation.enabled ? observation : undefined;
  },
}));
beforeEach(() => {
  observation.enabled = true;
  vi.clearAllMocks();
});

const tournamentId = 'locality-tournament';
const ids = { tournamentId, eventId: 'event', drawId: 'draw', matchUpId: 'match' };

it.each([true, false])(
  'records the event and schedule cache misses and identifies event warming (enabled=%s)',
  async (enabled) => {
    observation.enabled = enabled;
    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      tournamentAttributes: { tournamentId },
      drawProfiles: [{ drawSize: 4 }],
    });
    tournamentEngine.setState(tournamentRecord);
    const eventId = tournamentRecord.events![0].eventId!;
    tournamentEngine.publishEvent({ eventId });
    tournamentEngine.publishOrderOfPlay();
    const record = tournamentEngine.getTournament().tournamentRecord;
    const findTournamentRecord = vi.fn().mockResolvedValue({ tournamentRecord: record });
    const fetchTournamentRecords = vi.fn().mockResolvedValue({ tournamentRecords: { [tournamentId]: record } });
    const storage = { findTournamentRecord, fetchTournamentRecords } as never;
    const values = new Map();
    const delivery = new FactoryHttpDelivery(undefined as never, undefined as never, values as never);
    const reads = [
      { key: 'ged|' + tournamentId + '|' + eventId, load: (p) => getEventData(p, storage) },
      { key: 'schedule|' + tournamentId, load: (p) => getCompetitionScheduleMatchUps(p, storage) },
    ];
    for (const { key, load } of reads) {
      const params = { tournamentId, eventId };
      expect((await delivery.cacheFx(key, load, params)).error).toBeUndefined();
      expect((await delivery.cacheFx(key, load, params))._cached).toBe(true);
    }
    expect(
      await warmEventDataCache({ evictedEventKeys: [reads[0].key], cacheManager: values, storage } as never),
    ).toEqual([reads[0].key]);
    findTournamentRecord.mockResolvedValueOnce({ error: 'missing' });
    expect(await getEventData({ tournamentId, eventId }, storage)).toEqual({ error: 'missing' });
    expect(findTournamentRecord).toHaveBeenCalledTimes(3);
    expect(fetchTournamentRecords).toHaveBeenCalledTimes(1);
    expect(observation.observeAccess.mock.calls.map(([access]) => access.route)).toEqual(
      enabled ? ['publicEvent', 'publicSchedule', 'warmEvent'] : [],
    );
  },
);

it('counts a queue after fetch even when a later precondition refuses, and ignores unsuccessful fetches', async () => {
  const record = { tournamentId };
  markRecordRevision(record, tournamentId, 'row-token');
  const fetchTournamentRecords = vi.fn().mockResolvedValue({ tournamentRecords: { [tournamentId]: record } });
  const payload = {
    tournamentId,
    methods: [{ method: 'setMatchUpFormat', params: { drawId: ids.drawId } }],
    [operatorScorePrecondition]: () => {
      throw new Error('refused-after-read');
    },
  };
  const queue = () => executionQueue(payload, undefined, { fetchTournamentRecords } as never);
  expect((await queue()).error).toBe('refused-after-read');
  expect(observation.observeAccess).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      kind: 'queue',
      route: 'queue',
      tournamentId,
      eligible: true,
      drawIds: [ids.drawId],
      version: recordRevision(record),
    }),
  );
  fetchTournamentRecords.mockResolvedValueOnce({ error: 'read-failure' });
  expect((await queue()).error).toBe('read-failure');
  observation.enabled = false;
  expect((await queue()).error).toBe('refused-after-read');
  expect(observation.observeAccess).toHaveBeenCalledTimes(1);
  expect(observation.observeCommit).not.toHaveBeenCalled();
});

it('separates physical query reads, full fallbacks with no version and failed fetches', async () => {
  const method = 'matchUpActions';
  const footprint = tools.getQueryFootprint({ methods: [{ method, params: ids }] });
  const record = { tournamentId, events: [{ eventId: ids.eventId, drawDefinitions: [{ drawId: ids.drawId }] }] };
  markRecordRevision(record, tournamentId, 'authoritative');
  const readPhysicalFootprint = vi
    .fn()
    .mockResolvedValueOnce({ kind: 'partial', tournamentRecord: record, loadedFootprint: footprint })
    .mockResolvedValue({ kind: 'fallback' });
  const fetchTournamentRecords = vi
    .fn()
    .mockResolvedValueOnce({
      tournamentRecords: { [tournamentId]: { ...record } },
      serverUpdatedAt: { [tournamentId]: 'time' },
    })
    .mockResolvedValue({ error: 'read-failure' });
  const readerForTournament = vi.fn((id: string) => (id === tournamentId ? readPhysicalFootprint : undefined));
  const query = () =>
    queryTournamentRecords({ tournamentId, method, params: ids }, {
      readerForTournament,
      fetchTournamentRecords,
    } as never);
  await query();
  await query();
  expect(await query()).toEqual({ error: 'read-failure' });
  expect(readerForTournament).toHaveBeenCalledTimes(3);
  expect(readPhysicalFootprint).toHaveBeenCalledTimes(3);
  expect(fetchTournamentRecords).toHaveBeenCalledTimes(2);
  const common = { kind: 'read', route: 'privateQuery', tournamentId, drawIds: [ids.drawId], eligible: true };
  expect(observation.observeAccess.mock.calls).toEqual([
    [{ ...common, physicalRead: true, version: recordRevision(record) }],
    [{ ...common, physicalRead: false, version: undefined }],
  ]);
});

it('counts a whole operator read only after authorization even when DTO construction fails', async () => {
  const record = {
    tournamentId,
    events: [{ eventId: ids.eventId, drawDefinitions: [{ drawId: ids.drawId }] }],
    parentOrganisation: { organisationId: 'p' },
  };
  markRecordRevision(record, tournamentId, 'operator-revision');
  const grants = vi
    .fn()
    .mockResolvedValueOnce([])
    .mockResolvedValue([{ userId: 'u', providerId: 'p', tournamentId, capability: 'canEnterScores', scope: {} }]);
  const service = new OperatorMatchService(
    undefined as never,
    { fetchTournamentRecords: async () => ({ tournamentRecords: { [tournamentId]: record } }) } as never,
    { gate: async () => null } as never,
    { findForSubject: grants } as never,
  );
  const user = { userId: 'u', providerIds: ['p'], providerRoles: {} } as never;
  await expect(service.read(ids, user)).rejects.toThrow();
  expect(observation.observeAccess).not.toHaveBeenCalled();
  vi.spyOn(service as any, 'matchDto').mockImplementation(() => {
    throw new Error('DTO unavailable');
  });
  await expect(service.read(ids, user)).rejects.toThrow('DTO unavailable');
  expect(observation.observeAccess).toHaveBeenCalledExactlyOnceWith({
    kind: 'read',
    route: 'operator',
    tournamentId,
    drawIds: [ids.drawId],
    eligible: false,
    version: recordRevision(record),
  });
});

function database() {
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith('DELETE FROM tournaments')) return { rowCount: 1, rows: [{ tournament_id: 'deleted' }] };
    return { rowCount: 1, rows: [] };
  });
  const pool = { query, connect: async () => ({ query, release: () => undefined }) };
  return { query, storage: new PostgresTournamentStorage(pool as never), receipts: new CommandReceipts(pool as never) };
}

it.each(['success', 'refusal', 'failedCommit'])(
  'publishes save and actual delete rows only after confirmed COMMIT (%s)',
  async (outcome) => {
    const { storage, query, receipts } = database();
    const record = { tournamentId, tournamentName: '東京' };
    const command = { commandId: 'command-123', commandActor: 'actor', commandFingerprint: 'a'.repeat(64) };
    const result = receipts.execute(command, async () => {
      expect(await storage.saveTournamentRecords({ tournamentRecord: record })).toMatchObject({ success: true });
      await storage.removeTournamentRecords({ tournamentIds: ['deleted', 'missing'] });
      expect(observation.observeCommit).not.toHaveBeenCalled();
      if (outcome === 'failedCommit') {
        query
          .mockImplementationOnce(async () => ({ rowCount: 1, rows: [] }))
          .mockRejectedValueOnce(new Error('commit failed'));
      }
      return { success: outcome !== 'refusal' };
    });
    if (outcome === 'failedCommit') await expect(result).rejects.toThrow('commit failed');
    else expect(await result).toMatchObject({ success: outcome === 'success' });
    expect(query.mock.calls.map(([sql]) => sql)).toContain(outcome === 'success' ? 'COMMIT' : 'ROLLBACK');
    expect(observation.observeCommit.mock.calls).toEqual(
      outcome === 'success'
        ? [
            [tournamentId, 'save', JSON.stringify(record).length],
            ['deleted', 'delete'],
          ]
        : [],
    );
  },
);

it('tracks an autocommitted save, omits fenced writes and empty deletes, and leaves disabled DELETE SQL unchanged', async () => {
  const { storage, query } = database();
  const record = { tournamentId };
  await storage.saveTournamentRecord({ tournamentRecord: record });
  query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
  expect(await storage.saveTournamentRecord({ tournamentRecord: record })).toMatchObject({ fenced: true });
  query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
  await storage.removeTournamentRecords({ tournamentId: 'missing' });
  observation.enabled = false;
  await storage.removeTournamentRecords({ tournamentId });
  expect(query.mock.lastCall?.[0]).toBe('DELETE FROM tournaments WHERE tournament_id = ANY($1)');
  await storage.saveTournamentRecord({ tournamentRecord: record });
  expect(observation.observeCommit.mock.calls).toEqual([[tournamentId, 'save', JSON.stringify(record).length]]);
});

it.runIf(process.env.STORAGE_PROVIDER === 'postgres')(
  'observes committed PostgreSQL rows once through durable replay, rollback and subset delete',
  async () => {
    const pool = new Pool(getPostgresConfig());
    const storage = new PostgresTournamentStorage(pool);
    const receipts = new CommandReceipts(pool);
    const id = 'locality-' + randomUUID();
    const command = { commandId: randomUUID(), commandActor: id, commandFingerprint: 'f'.repeat(64) };
    const record = { tournamentId: id, tournamentName: '日本' };
    const save = async () => storage.saveTournamentRecord({ tournamentRecord: record });
    const remove = async () => storage.removeTournamentRecords({ tournamentIds: [id, 'missing-' + id] });
    try {
      expect(await receipts.execute(command, save)).toMatchObject({ success: true });
      expect(await receipts.execute(command, save)).toMatchObject({ deduplicated: true });
      expect(
        await receipts.execute({ ...command, commandId: randomUUID() }, async () => {
          await remove();
          return { error: 'refused' };
        }),
      ).toEqual({ error: 'refused' });
      expect((await storage.findTournamentRecord({ tournamentId: id })).tournamentRecord).toEqual(record);
      expect(observation.observeCommit.mock.calls).toEqual([[id, 'save', JSON.stringify(record).length]]);
      await remove();
      expect((await storage.findTournamentRecord({ tournamentId: id })).error).toBeTruthy();
      expect(observation.observeCommit.mock.calls).toEqual([
        [id, 'save', JSON.stringify(record).length],
        [id, 'delete'],
      ]);
    } finally {
      try {
        await pool.query('DELETE FROM command_receipts WHERE actor = $1', [id]);
        await pool.query('DELETE FROM tournaments WHERE tournament_id = $1', [id]);
      } finally {
        await pool.end();
      }
    }
  },
);
