import { PostgresTournamentStorage } from './postgres-tournament.storage';
import { readPhysicalFootprint } from './physicalFootprintReader';
import { ShardBodyCache } from './shardBodyCache';
import { tools } from 'tods-competition-factory';

vi.mock('./physicalFootprintReader', () => ({
  readPhysicalFootprint: vi.fn(async () => ({ kind: 'fallback', reason: 'unsupported-footprint' })),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it('binds one positive cache to every authorized reader on an adapter and isolates distinct adapters', async () => {
  vi.stubEnv('CFS_PHYSICAL_FOOTPRINT_READS', 'true');
  vi.stubEnv('CFS_PHYSICAL_FOOTPRINT_TOURNAMENT_IDS', ' a,b ');
  vi.stubEnv('CFS_SHARD_CACHE_BYTES', '4096');
  const pool = {} as never;
  const request = {
    footprint: tools.getMutationFootprint({ methods: [{ method: 'setMatchUpFormat', params: { drawId: 'd' } }] }),
  };
  const make = () => new PostgresTournamentStorage(pool);
  const storage = make();
  expect(storage.readerForTournament('outside')).toBeUndefined();
  await storage.readerForTournament('a')!(request);
  await storage.readerForTournament('b')!(request);
  await make().readerForTournament('a')!(request);
  const calls: readonly (readonly unknown[])[] = vi.mocked(readPhysicalFootprint).mock.calls;
  expect(calls[0]).toEqual([pool, { ...request, tournamentId: 'a' }, expect.any(ShardBodyCache)]);
  expect(calls[1]).toEqual([pool, { ...request, tournamentId: 'b' }, calls[0][2]]);
  expect(calls[1][2]).toBe(calls[0][2]);
  expect(calls[2][2]).toBeInstanceOf(ShardBodyCache);
  expect(calls[2][2]).not.toBe(calls[0][2]);
  vi.stubEnv('CFS_SHARD_CACHE_BYTES', '0');
  await make().readerForTournament('a')!(request);
  expect(calls[3]).toEqual([pool, { ...request, tournamentId: 'a' }]);
  vi.stubEnv('CFS_SHARD_CACHE_BYTES', '4096');
  vi.stubEnv('CFS_PHYSICAL_FOOTPRINT_READS', 'false');
  expect(make().readerForTournament('a')).toBeUndefined();
});
