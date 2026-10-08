import { generateTournamentRecord } from '../../../../services/fileSystem/generateTournamentRecord';
import { removeTournamentRecords } from '../../../../services/fileSystem/removeTournamentRecords';
import { testTournamentId } from '../../../../common/constants/test';
import { factoryConstants } from 'tods-competition-factory';
import fileStorage from '../../../../services/fileSystem';

const tournamentId = testTournamentId(__filename);
import { executionQueue } from './executionQueue';
import 'dotenv/config';

import type { TournamentStorageService } from 'src/storage/tournament-storage.service';

// Minimal mock that delegates to fileStorage for test purposes
const mockStorage = {
  fetchTournamentRecords: (params) => fileStorage.fetchTournamentRecords(params),
  saveTournamentRecords: (params) => fileStorage.saveTournamentRecords(params),
  modifyProviderCalendar: () => Promise.resolve({ success: true }),
} as unknown as TournamentStorageService;

const testUser = { providerId: 'test-provider', roles: ['superadmin'] };

describe('executionQueue', () => {
  it('can generate a tournamentRecord', async () => {
    // FIRST: remove any existing tournamentRecord with this tournamentId
    let result: any = await removeTournamentRecords({ tournamentId });
    expect(result.success).toEqual(true);

    // SECOND: generate a tournamentRecord with this tournamentId and persist to storage
    result = await generateTournamentRecord(
      {
        tournamentAttributes: { tournamentId },
        drawProfiles: [{ drawSize: 16 }],
      },
      testUser,
    );
    expect(result.success).toEqual(true);

    const payload = {
      methods: [
        {
          method: 'setTournamentDates',
          params: {
            startDate: '2024-01-01',
            endDate: '2024-01-02',
            tournamentId,
          },
        },
      ],
      tournamentIds: [tournamentId, 'test2'],
    };

    // THIRD: execute a directive on the tournamentRecord
    result = await executionQueue(payload, undefined, mockStorage);
    expect(result.success).toEqual(true);

    // FOURTH: attempt to execute a directive on a tournamentRecord that does not exist
    result = await executionQueue({
      methods: [{ method: 'setTournamentDates', params: { tournamentId } }],
      tournamentIds: ['doesNotExist'],
    }, undefined, mockStorage);
    expect(result.error).toEqual(factoryConstants.errorConditionConstants.MISSING_TOURNAMENT_RECORD);
  });

  // executionQueue cannot create a tournament: `newTournamentRecord` is not a mutation method, and a
  // batch naming only a new id fails the fetch. Tournaments are created through `/factory/save` and
  // `/factory/generate`, which attach the provider's privacy policy and the provisioner stamp. Hooks
  // for creation inside executionQueue were removed on 2026-10-08 because they could never run; if
  // this starts succeeding, creation has a new path and those hooks belong on it.
  it('cannot create a tournament, even alongside an existing one', async () => {
    await removeTournamentRecords({ tournamentId });
    const gen: any = await generateTournamentRecord({ tournamentAttributes: { tournamentId } }, testUser);
    expect(gen.success).toEqual(true);

    const saveTournamentRecords = vi.fn();
    const storage = { ...mockStorage, saveTournamentRecords } as unknown as TournamentStorageService;
    const created = 'executionQueue-spec-new';
    const newTournament = { method: 'newTournamentRecord', params: { tournamentId: created } };

    let result: any = await executionQueue(
      { methods: [newTournament], tournamentIds: [tournamentId, created] },
      undefined,
      storage,
    );
    expect(result.error?.code).toEqual('ERR_NOT_FOUND_METHOD');

    result = await executionQueue({ methods: [newTournament], tournamentIds: [created] }, undefined, storage);
    expect(result.error).toEqual(factoryConstants.errorConditionConstants.MISSING_TOURNAMENT_RECORD);
    expect(saveTournamentRecords).not.toHaveBeenCalled();
  });

  it('records the factory error CODE (not "[object Object]") on a rejected mutation', async () => {
    await removeTournamentRecords({ tournamentId });
    const gen: any = await generateTournamentRecord(
      { tournamentAttributes: { tournamentId }, drawProfiles: [{ drawSize: 8 }] },
      testUser,
    );
    expect(gen.success).toEqual(true);

    const recordMutation = vi.fn().mockResolvedValue(undefined);
    const auditService = { recordMutation } as any;

    // Schedule against a non-existent draw → the engine returns an
    // object-shaped factory error ({ message, code }). Pre-fix the audit
    // hook String()'d the object to the useless literal "[object Object]".
    const payload = {
      methods: [
        {
          method: 'addMatchUpScheduleItems',
          params: {
            drawId: 'no-such-draw',
            matchUpId: 'no-such-matchup',
            schedule: { scheduledDate: '2024-01-01' },
            tournamentId,
          },
        },
      ],
      tournamentIds: [tournamentId],
      rollbackOnError: true,
    };

    const result: any = await executionQueue(payload, undefined, mockStorage, auditService);
    expect(result.success).not.toBe(true);
    expect(recordMutation).toHaveBeenCalledTimes(1);
    const recorded = recordMutation.mock.calls[0][0];
    expect(recorded.status).toBe('rejected');
    expect(typeof recorded.errorCode).toBe('string');
    expect(recorded.errorCode).not.toBe('[object Object]');
    expect(recorded.errorCode.startsWith('ERR_')).toBe(true);
  });
});
