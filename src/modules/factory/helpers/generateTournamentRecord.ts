import { governors } from 'tods-competition-factory';
import { SUPER_ADMIN } from 'src/common/constants/roles';

export async function generateTournamentRecord(mockProfile?: any, user?: any) {
  const genResult = await governors.mocksGovernor.generateTournamentRecord(mockProfile);
  if (!genResult || genResult.error) throw new Error(genResult?.error || 'Could not generate tournament record');
  const tournamentRecord: any = genResult.tournamentRecord;

  // Enforce provider association: non-SUPER_ADMIN users can only generate
  // tournaments for their own provider. SUPER_ADMIN may specify any provider
  // or omit it entirely.
  if (!user?.roles?.includes(SUPER_ADMIN)) {
    const providerId = user?.providerId;
    if (!providerId) throw new Error('User has no provider association');
    tournamentRecord.parentOrganisation = { organisationId: providerId };
  } else if (!tournamentRecord.parentOrganisation?.organisationId && user?.providerId) {
    // SUPER_ADMIN: default to their provider if none specified in the generated record
    tournamentRecord.parentOrganisation = { organisationId: user.providerId };
  }

  return { tournamentRecord, tournamentRecords: { [tournamentRecord.tournamentId]: tournamentRecord } };
}
