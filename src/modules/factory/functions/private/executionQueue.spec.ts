import { generateTournamentRecord } from '../../../../services/fileSystem/generateTournamentRecord';
import { removeTournamentRecords } from '../../../../services/fileSystem/removeTournamentRecords';
import { factoryConstants } from 'tods-competition-factory';
import { TEST } from '../../../../common/constants/test';
import fileStorage from '../../../../services/fileSystem';
import { executionQueue } from './executionQueue';
import 'dotenv/config';

import type { TournamentStorageService } from 'src/storage/tournament-storage.service';

// Minimal mock that delegates to fileStorage for test purposes
const mockStorage = {
  fetchTournamentRecords: (params) => fileStorage.fetchTournamentRecords(params),
  saveTournamentRecords: (params) => fileStorage.saveTournamentRecords(params),
  modifyProviderCalendar: () => Promise.resolve({ success: true }),
} as unknown as TournamentStorageService;

describe('executionQueue', () => {
  it('can generate a tournamentRecord', async () => {
    // FIRST: remove any existing tournamentRecord with this tournamentId
    let result: any = await removeTournamentRecords({ tournamentId: TEST });
    expect(result.success).toEqual(true);

    // SECOND: generate a tournamentRecord with this tournamentId and persist to storage
    result = await generateTournamentRecord({
      tournamentAttributes: { tournamentId: TEST },
      drawProfiles: [{ drawSize: 16 }],
    });
    expect(result.success).toEqual(true);

    const payload = {
      methods: [
        {
          method: 'setTournamentDates',
          params: {
            startDate: '2024-01-01',
            endDate: '2024-01-02',
            tournamentId: TEST,
          },
        },
      ],
      tournamentIds: [TEST, 'test2'],
    };

    // THIRD: execute a directive on the tournamentRecord
    result = await executionQueue(payload, undefined, mockStorage);
    expect(result.success).toEqual(true);

    // FOURTH: attempt to execute a directive on a tournamentRecord that does not exist
    result = await executionQueue({
      methods: [{ method: 'setTournamentDates', params: { tournamentId: TEST } }],
      tournamentIds: ['doesNotExist'],
    }, undefined, mockStorage);
    expect(result.error).toEqual(factoryConstants.errorConditionConstants.MISSING_TOURNAMENT_RECORD);
  });
});
