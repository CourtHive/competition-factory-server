import { codesRecordFile, legacyRecordFile } from './tournamentRecordFile';
import { removeTournamentRecords } from './removeTournamentRecords';
import { saveTournamentRecords } from './saveTournamentRecords';
import { testTournamentId } from '../../common/constants/test';
import { findTournamentRecord } from './findTournamentRecord';
import { STORAGE } from '../../common/constants/app';
import * as fs from 'fs-extra';

const tournamentId = testTournamentId(__filename);

const writeLegacy = (record: any) => {
  fs.ensureDirSync(STORAGE);
  fs.writeFileSync(legacyRecordFile(tournamentId), JSON.stringify(record));
};

afterEach(async () => {
  await removeTournamentRecords({ tournamentId });
});

describe('fileSystem record suffix: write .codes.json, still read .tods.json', () => {
  it('saves as .codes.json and reads it back', async () => {
    await saveTournamentRecords({ tournamentRecord: { tournamentId, tournamentName: 'codes' } });
    expect(fs.existsSync(codesRecordFile(tournamentId))).toEqual(true);
    expect(fs.existsSync(legacyRecordFile(tournamentId))).toEqual(false);

    const result: any = await findTournamentRecord({ tournamentId });
    expect(result.tournamentRecord.tournamentName).toEqual('codes');
  });

  it('finds a record stored under the legacy .tods.json suffix', async () => {
    writeLegacy({ tournamentId, tournamentName: 'legacy' });
    expect(fs.existsSync(codesRecordFile(tournamentId))).toEqual(false);

    const result: any = await findTournamentRecord({ tournamentId });
    expect(result.tournamentRecord.tournamentName).toEqual('legacy');
  });

  it('a save replaces the legacy file, so the two can never disagree', async () => {
    writeLegacy({ tournamentId, tournamentName: 'legacy' });
    await saveTournamentRecords({ tournamentRecord: { tournamentId, tournamentName: 'saved' } });

    expect(fs.existsSync(legacyRecordFile(tournamentId))).toEqual(false);
    const result: any = await findTournamentRecord({ tournamentId });
    expect(result.tournamentRecord.tournamentName).toEqual('saved');
  });

  it('remove deletes a legacy file and counts it', async () => {
    writeLegacy({ tournamentId });
    const result: any = await removeTournamentRecords({ tournamentId });
    expect(result.removed).toEqual(1);
    expect(fs.existsSync(legacyRecordFile(tournamentId))).toEqual(false);
    expect((await findTournamentRecord({ tournamentId })).error).toEqual('Tournament not found');
  });
});
