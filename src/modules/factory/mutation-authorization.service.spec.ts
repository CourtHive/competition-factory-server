import { MutationAuthorizationService } from './mutation-authorization.service';
import { CREATED_BY_USER_ID } from './helpers/checkTournamentAccess';

// Scoping must be ON for the per-tournament gate to have anything to say.
jest.mock('src/common/constants/feature-flags', () => ({
  isTournamentAccessScopingEnabled: () => true,
}));

const TID = 't-1';
const PROVIDER = 'prov-1';

function makeTournament(createdByUserId = 'someone-else') {
  return {
    tournamentId: TID,
    parentOrganisation: { organisationId: PROVIDER },
    extensions: [{ name: CREATED_BY_USER_ID, value: createdByUserId }],
  };
}

function build({ assignmentRole, permissions }: { assignmentRole?: string; permissions?: any } = {}) {
  const providerStorage: any = {
    getProvider: jest.fn().mockResolvedValue({
      providerConfigCaps: {},
      providerConfigSettings: permissions ? { permissions } : {},
    }),
  };
  const tournamentStorageService: any = {
    fetchTournamentRecords: jest.fn().mockResolvedValue({ tournamentRecords: { [TID]: makeTournament() } }),
  };
  const assignmentsService: any = {
    getAssignedRoles: jest.fn().mockResolvedValue(assignmentRole ? new Map([[TID, assignmentRole]]) : new Map()),
  };
  const service = new MutationAuthorizationService(providerStorage, tournamentStorageService, assignmentsService);
  return { service, providerStorage, tournamentStorageService, assignmentsService };
}

const director = {
  userId: 'user-1',
  isSuperAdmin: false,
  providerRoles: { [PROVIDER]: 'DIRECTOR' },
  providerIds: [PROVIDER],
};
const superAdmin = { userId: 'admin-1', isSuperAdmin: true, providerRoles: {}, providerIds: [] };

describe('MutationAuthorizationService.gate', () => {
  it('allows a DIRECTOR-assigned user to run any method', async () => {
    const { service } = build({ assignmentRole: 'DIRECTOR' });
    const denial = await service.gate({
      userContext: director,
      tournamentIds: [TID],
      requestedMethods: ['addEvent'],
    });
    expect(denial).toBeNull();
  });

  it('denies a SCORER-assigned user a non-scoring method', async () => {
    const { service } = build({ assignmentRole: 'SCORER' });
    const denial = await service.gate({
      userContext: director,
      tournamentIds: [TID],
      requestedMethods: ['addDrawDefinition'],
    });
    expect(denial).toBe('Not authorized to modify this tournament');
  });

  it('allows a SCORER-assigned user to score', async () => {
    const { service } = build({ assignmentRole: 'SCORER' });
    const denial = await service.gate({
      userContext: director,
      tournamentIds: [TID],
      requestedMethods: ['setMatchUpStatus'],
    });
    expect(denial).toBeNull();
  });

  it('enforces the provider permission map', async () => {
    const { service } = build({ assignmentRole: 'DIRECTOR', permissions: { canCreateEvents: false } });
    const denial = await service.gate({
      userContext: director,
      tournamentIds: [TID],
      requestedMethods: ['addEvent'],
    });
    expect(denial).toBe('Action not permitted: addEvent');
  });

  it('super-admin bypasses the provider permission map', async () => {
    const { service } = build({ permissions: { canCreateEvents: false } });
    const denial = await service.gate({
      userContext: superAdmin,
      tournamentIds: [TID],
      requestedMethods: ['addEvent'],
    });
    expect(denial).toBeNull();
  });

  it('is a no-op without a userContext or without tournamentIds', async () => {
    const { service, tournamentStorageService } = build();
    expect(await service.gate({ userContext: undefined, tournamentIds: [TID], requestedMethods: ['addEvent'] })).toBeNull();
    expect(await service.gate({ userContext: director, tournamentIds: [], requestedMethods: ['addEvent'] })).toBeNull();
    expect(tournamentStorageService.fetchTournamentRecords).not.toHaveBeenCalled();
  });
});
