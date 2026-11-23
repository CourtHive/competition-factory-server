import { queryTournamentRecords } from '../functions/private/queryTournamentRecords';
import { fetchQueryRecords, planQueryRead } from './fetchQueryRecords';
import { factoryConstants, tools } from 'tods-competition-factory';
import { describe, it, expect, vi } from 'vitest';

// constants and types
import type { ITournamentStorage } from 'src/storage/interfaces';

const ids = { tournamentId: 't', eventId: 'e', drawId: 'd', matchUpId: 'm' };
const method = 'matchUpActions';
const footprint = tools.getQueryFootprint({ methods: [{ method, params: ids }] });

describe('physical query admission and guard', () => {
  it('uses the factory declaration with an explicit draw-to-event binding', () => {
    expect(planQueryRead({ tournamentIds: ['t'] }, method, ids)).toEqual({
      tournamentId: 't',
      footprint,
      drawEventIds: { d: 'e' },
    });
  });

  it.each([
    [{ tournamentIds: ['t', 'u'] }, method, ids],
    [{ tournamentId: 't' }, method, { ...ids, tournamentId: 'other' }],
    [{ tournamentId: 't' }, method, { ...ids, eventId: '' }],
    [{ tournamentId: 't' }, method, { ...ids, tournamentRecord: {} }],
    [{ tournamentId: 't' }, 'getTournamentInfo', ids],
  ] as const)('keeps the ordinary fetch for unresolved or broader calls', async (fetchParams, name, params) => {
    const reader = vi.fn();
    const storage = {
      readerForTournament: () => reader,
      fetchTournamentRecords: vi.fn().mockResolvedValue({ error: 'ordinary' }),
    };
    const request = 'tournamentId' in fetchParams ? fetchParams : { tournamentIds: [...fetchParams.tournamentIds] };
    expect(await fetchQueryRecords(storage, request, name, params)).toEqual({ error: 'ordinary' });
    expect(storage.fetchTournamentRecords).toHaveBeenCalledExactlyOnceWith(request);
    expect(reader).not.toHaveBeenCalled();
  });

  it('uses the ordinary read on a layout miss and propagates database failures', async () => {
    const fetchParams = { tournamentId: 't', captureRevision: true };
    const reader = vi.fn().mockResolvedValue({ kind: 'fallback', reason: 'missing-shards-or-layout' });
    const storage = {
      readerForTournament: () => reader,
      fetchTournamentRecords: vi.fn().mockResolvedValue({ success: true, tournamentRecords: {} }),
    };
    await fetchQueryRecords(storage, fetchParams, method, ids);
    expect(storage.fetchTournamentRecords).toHaveBeenCalledExactlyOnceWith(fetchParams);
    const error = new Error('database unavailable');
    reader.mockRejectedValueOnce(error);
    await expect(fetchQueryRecords(storage, fetchParams, method, ids)).rejects.toBe(error);
    expect(storage.fetchTournamentRecords).toHaveBeenCalledTimes(1);
  });

  it('refuses an insufficient actual load through the real query engine before dispatch', async () => {
    const storage = {
      fetchTournamentRecords: vi.fn(),
      readerForTournament: () => async () => ({
        kind: 'partial',
        tournamentRecord: { tournamentId: 't', events: [{ eventId: 'e', drawDefinitions: [{ drawId: 'd' }] }] },
        loadedFootprint: { ...footprint, shards: ['shell', 'draw'] },
        previousServerUpdatedAt: '2026-11-23T00:00:00Z',
        parentRevision: '13/1234.0',
      }),
    };
    const result = await queryTournamentRecords(
      { tournamentId: 't', method, params: ids },
      storage as unknown as ITournamentStorage,
    );
    expect(result.error).toEqual(factoryConstants.errorConditionConstants.FOOTPRINT_NOT_LOADED);
    expect(storage.fetchTournamentRecords).not.toHaveBeenCalled();
  });
});
