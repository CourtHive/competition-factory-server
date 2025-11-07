import { governors } from 'tods-competition-factory';

export async function generateTournamentRecord(mockProfile?: any, user?: any) {
  void user; // TODO: unless user is SUPER_ADMIN, get user provider and attach to tournamentRecord.parentOrganisation
  const genResult = await governors.mocksGovernor.generateTournamentRecord(mockProfile);
  if (!genResult || genResult.error) throw new Error(genResult?.error || 'Could not generate tournament record');
  const tournamentRecord: any = genResult.tournamentRecord;
  return { tournamentRecord, tournamentRecords: { [tournamentRecord.tournamentId]: tournamentRecord } };
}
