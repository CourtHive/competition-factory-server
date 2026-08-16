import { warmEventDataCache, CACHE_TTL_MS } from './warmEventDataCache';
import { publicQueries } from 'src/modules/factory/functions/public';

jest.mock('src/modules/factory/functions/public', () => ({
  publicQueries: { getEventData: jest.fn() },
}));

const getEventData = publicQueries.getEventData as jest.Mock;

describe('warmEventDataCache', () => {
  const storage = {} as any;
  let cacheManager: { set: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    cacheManager = { set: jest.fn() };
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

  it('registers the seeded key when a tracker is supplied, and works without one', async () => {
    const trackKey = jest.fn();
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
