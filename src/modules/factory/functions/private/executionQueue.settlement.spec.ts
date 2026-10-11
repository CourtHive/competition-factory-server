import { executionQueue } from './executionQueue';

import type { TournamentStorageService } from 'src/storage/tournament-storage.service';

const h = vi.hoisted(() => ({ records: {}, execute: vi.fn(), setState: vi.fn() }));
vi.mock('../../engines/getMutationEngine', () => ({
  getMutationEngine: () => ({
    setState: h.setState,
    executionQueue: h.execute,
    getState: () => ({ tournamentRecords: h.records }),
  }),
}));

beforeEach(() => {
  h.records = { t: { tournamentId: 't', events: [{ eventId: 'e', drawDefinitions: [{ drawId: 'd' }] }] } };
  h.execute.mockReset().mockResolvedValue({ success: true });
  h.setState.mockReset();
});

function storage() {
  return {
    fetchTournamentRecords: vi.fn(async () => ({ tournamentRecords: h.records })),
    saveTournamentRecords: vi.fn(async () => ({ success: true })),
  };
}

it('stamps before engine execution and returns precisely those commands for acknowledgement and broadcast', async () => {
  const persisted = storage();
  const methods = [
    {
      method: 'settleRotatingPartnerResult',
      params: { drawId: 'd', requestId: 'r', recordedBy: 'spoofed', recordedAt: 'old' },
    },
  ];
  h.execute.mockImplementation(async (directives) => {
    const params = directives[0].params;
    Object.assign((h.records as { t: { events: { drawDefinitions: object[] }[] } }).t.events[0].drawDefinitions[0], {
      competitionSettlements: [
        { requestId: 'r', matchUpId: 'm', recordedBy: params.recordedBy, recordedAt: params.recordedAt },
      ],
    });
    return { success: true };
  });
  const result = await executionQueue(
    { tournamentIds: ['t'], userId: 'verified', methods },
    undefined,
    persisted as unknown as TournamentStorageService,
  );
  expect(result.success).toBe(true);
  expect(h.execute).toHaveBeenCalledWith(methods, undefined);
  expect(methods[0].params.recordedBy).toBe('verified');
  expect(methods[0].params.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(result.appliedMethods).toEqual(methods);
  expect(result.settlementAudits).toEqual([
    {
      tournamentId: 't',
      drawId: 'd',
      requestId: 'r',
      matchUpId: 'm',
      recordedBy: 'verified',
      recordedAt: methods[0].params.recordedAt,
    },
  ]);
  expect(result.appliedMethods).not.toBe(methods);
  expect(persisted.saveTournamentRecords).toHaveBeenCalledTimes(1);
});

it('refuses unverified settlement identity before executing or saving', async () => {
  const persisted = storage();
  const result = await executionQueue(
    {
      tournamentIds: ['t'],
      methods: [
        { method: 'settleRotatingPartnerResult', params: { drawId: 'd', requestId: 'r', recordedBy: 'client' } },
      ],
    },
    undefined,
    persisted as unknown as TournamentStorageService,
  );
  expect(result.error).toBe('Authenticated actor required for settlement');
  expect(h.execute).not.toHaveBeenCalled();
  expect(persisted.saveTournamentRecords).not.toHaveBeenCalled();
});

it('returns no audit confirmation when persistence fails', async () => {
  const persisted = storage();
  persisted.saveTournamentRecords.mockResolvedValue({ success: false });
  const result = await executionQueue(
    {
      tournamentIds: ['t'],
      userId: 'verified',
      methods: [{ method: 'settleRotatingPartnerResult', params: { drawId: 'd', requestId: 'r' } }],
    },
    undefined,
    persisted as unknown as TournamentStorageService,
  );
  expect(result.error).toBe('Could not persist tournament record(s)');
  expect(result.appliedMethods).toBeUndefined();
  expect(result.settlementAudits).toBeUndefined();
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
  expect(result.settlementAudits).toBeUndefined();
});

it('returns no receipts for a refused factory operation', async () => {
  const persisted = storage();
  h.execute.mockResolvedValue({ error: { code: 'ERR_INVALID_VALUES' } });
  const result = await executionQueue(
    {
      tournamentIds: ['t'],
      userId: 'verified',
      methods: [{ method: 'settleRotatingPartnerResult', params: { drawId: 'd', requestId: 'r' } }],
    },
    undefined,
    persisted as unknown as TournamentStorageService,
  );
  expect(result.error).toEqual({ code: 'ERR_INVALID_VALUES' });
  expect(persisted.saveTournamentRecords).not.toHaveBeenCalled();
  expect(result.settlementAudits).toBeUndefined();
});
