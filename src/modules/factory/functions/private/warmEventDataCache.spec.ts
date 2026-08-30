import { warmEventDataCache, CACHE_TTL_MS } from './warmEventDataCache';
import { publicQueries } from 'src/modules/factory/functions/public';
import type { Mock } from 'vitest';

vi.mock('src/modules/factory/functions/public', () => ({
  publicQueries: { getEventData: vi.fn() },
}));

const getEventData = publicQueries.getEventData as Mock;

describe('warmEventDataCache', () => {
  const storage = {} as any;
  let cacheManager: { set: Mock };

  beforeEach(() => {
    vi.clearAllMocks();
    cacheManager = { set: vi.fn() };
    getEventData.mockResolvedValue({ success: true, eventData: { eventInfo: {} }, participants: [] });
  });

  it('re-seeds each evicted event key with the full query result under the shared TTL', async () => {
    const warmed = await warmEventDataCache({
      evictedEventKeys: ['ged|t1|e1', 'ged|t1|e2'],
      cacheManager,
      storage,
    });

    expect(getEventData).toHaveBeenCalledWith({ tournamentId: 't1', eventId: 'e1' }, storage);
    expect(cacheManager.set).toHaveBeenCalledWith(
      'ged|t1|e1',
      { success: true, eventData: { eventInfo: {} }, participants: [] },
      CACHE_TTL_MS,
    );
    expect(warmed).toEqual(['ged|t1|e1', 'ged|t1|e2']);
  });

  it('seeds the SAME shape the cached read stores — participants included', async () => {
    // Regression guard for the failure the invalidate-not-seed comment documents: seeding the
    // notice's inner eventData alone omits participants and blanks every bracket side to TBD.
    await warmEventDataCache({ evictedEventKeys: ['ged|t1|e1'], cacheManager, storage });

    const seeded = cacheManager.set.mock.calls[0][1];
    expect(seeded).toHaveProperty('participants');
    expect(seeded).toHaveProperty('eventData');
  });

  it('does NOT cache a failed rebuild — that would pin an error for the whole TTL', async () => {
    getEventData.mockResolvedValueOnce({ error: { message: 'boom' } });

    const warmed = await warmEventDataCache({ evictedEventKeys: ['ged|t1|e1'], cacheManager, storage });

    expect(cacheManager.set).not.toHaveBeenCalled();
    expect(warmed).toEqual([]);
  });

  it('ignores keys that are not per-event payload keys', async () => {
    const warmed = await warmEventDataCache({
      evictedEventKeys: ['gtm|t1', 'ged|t1', 'ged||e1'],
      cacheManager,
      storage,
    });

    expect(getEventData).not.toHaveBeenCalled();
    expect(warmed).toEqual([]);
  });

  it('SKIPS the drawsProfile STUBS variant rather than seeding it with a FULL payload', async () => {
    // The rebuild here is always a FULL payload (one seeding path, deliberately). Seeding it under
    // `ged|t1|e1|s` would pin the ~600 KB document where a ~600 BYTE one belongs, and serve it to
    // every stub caller for the whole TTL — the same class of bug as caching a participants-less
    // payload, inverted. Not warmed rather than warmed correctly: a stub rebuild is cheap.
    const warmed = await warmEventDataCache({
      evictedEventKeys: ['ged|t1|e1', 'ged|t1|e1|s'],
      cacheManager,
      storage,
    });

    expect(warmed).toEqual(['ged|t1|e1']);
    expect(cacheManager.set.mock.calls.map((c: any[]) => c[0])).not.toContain('ged|t1|e1|s');
  });

  it('registers the seeded key when a tracker is supplied, and works without one', async () => {
    const trackKey = vi.fn();
    await warmEventDataCache({ evictedEventKeys: ['ged|t1|e1'], cacheManager, storage, trackKey });
    expect(trackKey).toHaveBeenCalledWith('ged|t1|e1');

    // The WebSocket path has no side-table and passes no tracker — must not throw.
    cacheManager.set.mockClear();
    await expect(
      warmEventDataCache({ evictedEventKeys: ['ged|t1|e1'], cacheManager, storage }),
    ).resolves.toEqual(['ged|t1|e1']);
    expect(cacheManager.set).toHaveBeenCalled();
  });

  it('no-ops without a cacheManager or storage rather than throwing', async () => {
    expect(await warmEventDataCache({ evictedEventKeys: ['ged|t1|e1'], storage } as any)).toEqual([]);
    expect(await warmEventDataCache({ evictedEventKeys: ['ged|t1|e1'], cacheManager } as any)).toEqual([]);
    expect(getEventData).not.toHaveBeenCalled();
  });
});
