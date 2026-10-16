import { executionQueue } from './executionQueue';

import type { TournamentStorageService } from 'src/storage/tournament-storage.service';

const h = vi.hoisted(() => ({ records: {}, execute: vi.fn() }));
vi.mock('../../engines/getMutationEngine', () => ({
  getMutationEngine: () => ({ executionQueue: h.execute }),
}));

beforeEach(() => {
  h.records = { t: { tournamentId: 't', events: [{ eventId: 'e', drawDefinitions: [{ drawId: 'd' }] }] } };
  h.execute.mockReset().mockResolvedValue({ success: true });
});

function storage() {
  return {
    fetchTournamentRecords: vi.fn(async () => ({ tournamentRecords: h.records })),
    saveTournamentRecords: vi.fn(async () => ({ success: true })),
  };
}

it.each(['settleRotatingPartnerResult', 'checkInParticipant'])(
  'returns appliedMethods for a stamped %s',
  async (method) => {
    const persisted = storage();
    const methods = [{ method, params: { drawId: 'd', recordedBy: 'verified', recordedAt: '2026-10-11T12:00:00Z' } }];
    const result = await executionQueue(
      { tournamentIds: ['t'], methods, serverStamped: true },
      undefined,
      persisted as unknown as TournamentStorageService,
    );
    expect(result.success).toBe(true);
    expect(result.appliedMethods).toEqual(methods);
    expect(result.appliedMethods).not.toBe(methods);
    expect(persisted.saveTournamentRecords).toHaveBeenCalledTimes(1);
  },
);

// The factory keeps a repeated requestId's original recordedBy/recordedAt (#5382(factory)), so the server no longer
// looks up the prior settlement: a retry's stamped values pass through untouched and the factory answers with the original.
it('leaves a retry timestamp to the factory', async () => {
  const persisted = storage();
  Object.assign((h.records as any).t.events[0].drawDefinitions[0], {
    competitionSettlements: [{ requestId: 'r', recordedAt: '2026-10-10T12:00:00Z' }],
  });
  const methods = [
    {
      method: 'settleRotatingPartnerResult',
      params: { drawId: 'd', requestId: 'r', recordedBy: 'verified', recordedAt: '2026-10-11T12:00:00Z' },
    },
  ];
  const result = await executionQueue(
    { tournamentIds: ['t'], methods },
    undefined,
    persisted as unknown as TournamentStorageService,
  );
  expect(result.success).toBe(true);
  expect(methods[0].params.recordedAt).toBe('2026-10-11T12:00:00Z');
  expect(result.appliedMethods).toBeUndefined();
});

it('returns no audit confirmation when persistence fails', async () => {
  const persisted = storage();
  persisted.saveTournamentRecords.mockResolvedValue({ success: false });
  const result = await executionQueue(
    {
      tournamentIds: ['t'],
      userId: 'verified',
      serverStamped: true,
      methods: [{ method: 'settleRotatingPartnerResult', params: { drawId: 'd', requestId: 'r' } }],
    },
    undefined,
    persisted as unknown as TournamentStorageService,
  );
  expect(result.error).toBe('Could not persist tournament record(s)');
  expect(result.appliedMethods).toBeUndefined();
});

it('does not stamp or return settlement payloads for an ordinary mutation', async () => {
  const persisted = storage();
  const methods = [{ method: 'setTournamentName', params: { tournamentName: 'Open' } }];
  const before = structuredClone(methods);
  const result = await executionQueue(
    { tournamentIds: ['t'], methods },
    undefined,
    persisted as unknown as TournamentStorageService,
  );
  expect(result.success).toBe(true);
  expect(methods).toEqual(before);
  expect(result.appliedMethods).toBeUndefined();
});

it('returns no applied methods for a refused factory operation', async () => {
  const persisted = storage();
  h.execute.mockResolvedValue({ error: { code: 'ERR_INVALID_VALUES' } });
  const result = await executionQueue(
    {
      tournamentIds: ['t'],
      userId: 'verified',
      serverStamped: true,
      methods: [{ method: 'settleRotatingPartnerResult', params: { drawId: 'd', requestId: 'r' } }],
    },
    undefined,
    persisted as unknown as TournamentStorageService,
  );
  expect(result.error).toEqual({ code: 'ERR_INVALID_VALUES' });
  expect(result.appliedMethods).toBeUndefined();
  expect(persisted.saveTournamentRecords).not.toHaveBeenCalled();
});
