import { generateTournamentRecord } from '../../../../services/fileSystem/generateTournamentRecord';
import { removeTournamentRecords } from '../../../../services/fileSystem/removeTournamentRecords';
import { queryTournamentRecords } from './queryTournamentRecords';
import { TEST } from '../../../../common/constants/test';
import fileStorage from 'src/services/fileSystem';
import levelStorage from 'src/services/levelDB';
import 'dotenv/config';

describe('queryTournamentRecords', () => {
  const storage = process.env.APP_STORAGE === 'levelDB' ? levelStorage : fileStorage;

  it('can query a tournamentRecord', async () => {
    // FIRST: remove any existing tournamentRecord with this tournamentId
    let result: any = await removeTournamentRecords({ tournamentId: TEST });
    expect(result.success).toEqual(true);

    // SECOND: generate a tournamentRecord with this tournamentId and persist to storage
    result = generateTournamentRecord({
      tournamentAttributes: { tournamentId: TEST },
      drawProfiles: [{ drawSize: 16 }],
    });
    expect(result.success).toEqual(true);

    // THIRD: execute a directive on the tournamentRecord
    result = await queryTournamentRecords(
      {
        params: { tournamentId: TEST },
        method: 'getTournamentInfo',
        tournamentId: TEST,
      },
      { storage },
    );
    expect(result.success).toEqual(true);
  });
});
