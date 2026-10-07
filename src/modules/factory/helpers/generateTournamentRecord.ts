import asyncGlobalState from 'src/modules/factory/engines/asyncGlobalState';
import { governors } from 'tods-competition-factory';
import { SUPER_ADMIN } from 'src/common/constants/roles';
import { sessionProviderId } from './actingProviderScope';

// types
import type { UserContext } from 'src/modules/account/auth/decorators/user-context.decorator';

export async function generateTournamentRecord(mockProfile?: any, user?: any, userContext?: UserContext) {
  // DECISION: mock generation needs its own engine-state context.
  // WHY: governors are not uniformly pure — mocksGovernor.generateTournamentRecord dispatches
  // notices, which write the factory instance state. A direct governor call is therefore an
  // entry point too, not just engine calls. See competition-factory#4564.
  const genResult = await asyncGlobalState.runWithInstanceState(async () =>
    governors.mocksGovernor.generateTournamentRecord(mockProfile),
  );
  if (!genResult || genResult.error) throw new Error(genResult?.error || 'Could not generate tournament record');
  const tournamentRecord: any = genResult.tournamentRecord;

  // The generated tournament belongs to the provider this SESSION acts for (MULTI_PROVIDER_CONTEXT_COMPLETION.md):
  // the provider a multi-provider user chose at login, or the one a provisioner request names. Not
  // `user.providerId`, which in CFS is the database row's legacy home. A SUPER_ADMIN may name any provider in the
  // profile, and otherwise gets their session's.
  const providerId = sessionProviderId(userContext);
  if (!user?.roles?.includes(SUPER_ADMIN)) {
    if (!providerId) throw new Error('Choose a provider before generating a tournament');
    tournamentRecord.parentOrganisation = { organisationId: providerId };
  } else if (!tournamentRecord.parentOrganisation?.organisationId && providerId) {
    tournamentRecord.parentOrganisation = { organisationId: providerId };
  }

  return { tournamentRecord, tournamentRecords: { [tournamentRecord.tournamentId]: tournamentRecord } };
}
