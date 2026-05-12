import { generateTournamentRecord } from '../../../../services/fileSystem/generateTournamentRecord';
import { removeTournamentRecords } from '../../../../services/fileSystem/removeTournamentRecords';
import { getCompetitionScheduleMatchUps } from '../public/getCompetitionScheduleMatchUps';
import { queryTournamentRecords } from './queryTournamentRecords';
import { getTournamentInfo } from '../public/getTournamentInfo';
import fileStorage from '../../../../services/fileSystem';
import { testTournamentId } from '../../../../common/constants/test';

const tournamentId = testTournamentId(__filename);
import 'dotenv/config';

import type { ITournamentStorage } from 'src/storage/interfaces';

const storage = fileStorage as unknown as ITournamentStorage;

const testUser = { providerId: 'test-provider', roles: ['superadmin'] };

describe('queryTournamentRecords', () => {
  it('can query a tournamentRecord', async () => {
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

    // THIRD: execute a directive on the tournamentRecord
    result = await queryTournamentRecords({
      params: { tournamentId },
      method: 'getTournamentInfo',
      tournamentId,
    }, storage);
    expect(result.tournamentInfo).toBeDefined();
    expect(result.success).toEqual(true);

    result = await getTournamentInfo({ tournamentId }, storage);
    expect(result.tournamentInfo).toBeDefined();
    expect(result.success).toEqual(true);

    result = await getCompetitionScheduleMatchUps({ tournamentId }, storage);
    expect(result.success).toEqual(true);

    // FOURTH: remove the tournamentRecord
    result = await removeTournamentRecords({ tournamentId });
    expect(result.success).toEqual(true);
  });
});
