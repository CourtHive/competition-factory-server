import { generateTournamentRecord } from '../../../../services/fileSystem/generateTournamentRecord';
import { removeTournamentRecords } from '../../../../services/fileSystem/removeTournamentRecords';
import { getCompetitionScheduleMatchUps } from '../public/getCompetitionScheduleMatchUps';
import { queryTournamentRecords } from './queryTournamentRecords';
import { getTournamentInfo } from '../public/getTournamentInfo';
import fileStorage from '../../../../services/fileSystem';
import { TEST } from '../../../../common/constants/test';
import 'dotenv/config';

import type { ITournamentStorage } from 'src/storage/interfaces';

const storage = fileStorage as unknown as ITournamentStorage;

describe('queryTournamentRecords', () => {
  it('can query a tournamentRecord', async () => {
    // FIRST: remove any existing tournamentRecord with this tournamentId
    let result: any = await removeTournamentRecords({ tournamentId: TEST });
    expect(result.success).toEqual(true);

    // SECOND: generate a tournamentRecord with this tournamentId and persist to storage
    result = await generateTournamentRecord({
      tournamentAttributes: { tournamentId: TEST },
      drawProfiles: [{ drawSize: 16 }],
    });
    expect(result.success).toEqual(true);

    // THIRD: execute a directive on the tournamentRecord
    result = await queryTournamentRecords({
      params: { tournamentId: TEST },
      method: 'getTournamentInfo',
      tournamentId: TEST,
    }, storage);
    expect(result.tournamentInfo).toBeDefined();
    expect(result.success).toEqual(true);

    result = await getTournamentInfo({ tournamentId: TEST }, storage);
    expect(result.tournamentInfo).toBeDefined();
    expect(result.success).toEqual(true);

    result = await getCompetitionScheduleMatchUps({ tournamentId: TEST }, storage);
    expect(result.success).toEqual(true);

    // FOURTH: remove the tournamentRecord
    result = await removeTournamentRecords({ tournamentId: TEST });
    expect(result.success).toEqual(true);
  });
});
