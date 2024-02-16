import { generateTournamentRecord } from '../../../../services/fileSystem/generateTournamentRecord';
import { removeTournamentRecords } from '../../../../services/fileSystem/removeTournamentRecords';
import { factoryConstants } from 'tods-competition-factory';
import { TEST } from '../../../../common/constants/test';
import { executionQueue } from './executionQueue';
import fileStorage from 'src/services/fileSystem';
import levelStorage from 'src/services/levelDB';
import 'dotenv/config';

describe('executionQueue', () => {
  const storage = process.env.APP_STORAGE === 'levelDB' ? levelStorage : fileStorage;

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

    const services = { storage };

    // THIRD: execute a directive on the tournamentRecord
    result = await executionQueue(payload, services);
    expect(result.success).toEqual(true);

    // FOURTH: attempt to execute a directive on a tournamentRecord that does not exist
    result = await executionQueue(
      {
        methods: [{ method: 'setTournamentDates', params: { tournamentId: TEST } }],
        tournamentIds: ['doesNotExist'],
      },
      services,
    );
    expect(result.error).toEqual(factoryConstants.errorConditionConstants.MISSING_TOURNAMENT_RECORD);
  });
});
