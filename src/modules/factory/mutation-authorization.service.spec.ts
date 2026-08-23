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
    events: [
      {
        eventId: 'e1',
        drawDefinitions: [
          {
            drawId: 'd1',
            structures: [
              {
                structureId: 's1',
                matchUps: [
                  { matchUpId: 'court7-match', schedule: { courtId: 'court-7', scheduledDate: '2026-08-24' } },
                  { matchUpId: 'centre-match', schedule: { courtId: 'centre', scheduledDate: '2026-08-24' } },
                  { matchUpId: 'unscheduled-match' },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function build({ assignmentRole, permissions, grants = [] }: { assignmentRole?: string; permissions?: any; grants?: any[] } = {}) {
  const providerStorage: any = {
    getProvider: jest.fn().mockResolvedValue({
      providerConfigCaps: {},
      providerConfigSettings: permissions ? { permissions } : {},
    }),
  };
  const tournamentStorageService: any = {
    fetchTournamentRecords: jest.fn().mockResolvedValue({ tournamentRecords: { [TID]: makeTournament() } }),
  };
  const grantStorage: any = { findForSubject: jest.fn().mockResolvedValue(grants) };
  const assignmentsService: any = {
    getAssignedRoles: jest.fn().mockResolvedValue(assignmentRole ? new Map([[TID, assignmentRole]]) : new Map()),
  };
  const service = new MutationAuthorizationService(providerStorage, grantStorage, tournamentStorageService, assignmentsService);
  return { service, providerStorage, tournamentStorageService, assignmentsService, grantStorage };
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

describe('MutationAuthorizationService.gate — scoped grants', () => {
  const score = (matchUpId: string) => [{ method: 'setMatchUpStatus', params: { matchUpId, drawId: 'd1' } }];

  it('is unrestricted when the subject holds no grants — the table is additive', async () => {
    const { service } = build({ assignmentRole: 'DIRECTOR' });
    const denial = await service.gate({
      userContext: director,
      tournamentIds: [TID],
      requestedMethods: ['setMatchUpStatus'],
      methods: score('centre-match'),
    });
    expect(denial).toBeNull();
  });

  // The capability a global boolean cannot express: canEnterScores is on for
  // both of these, and only the court tells them apart.
  describe('a Court-7 recorder', () => {
    const courtSeven = [{ grantId: 'g1', scope: { courtIds: ['court-7'] }, capability: 'enterScores' }];

    it('may score on Court 7', async () => {
      const { service } = build({ assignmentRole: 'DIRECTOR', grants: courtSeven });
      const denial = await service.gate({
        userContext: director,
        tournamentIds: [TID],
        requestedMethods: ['setMatchUpStatus'],
        methods: score('court7-match'),
      });
      expect(denial).toBeNull();
    });

    it('may NOT score the final on Centre', async () => {
      const { service } = build({ assignmentRole: 'DIRECTOR', grants: courtSeven });
      const denial = await service.gate({
        userContext: director,
        tournamentIds: [TID],
        requestedMethods: ['setMatchUpStatus'],
        methods: score('centre-match'),
      });
      expect(denial).toBe('Not authorized for this courtIds');
    });

    it('may NOT score a matchUp with no court — unknown is not permission', async () => {
      const { service } = build({ assignmentRole: 'DIRECTOR', grants: courtSeven });
      const denial = await service.gate({
        userContext: director,
        tournamentIds: [TID],
        requestedMethods: ['setMatchUpStatus'],
        methods: score('unscheduled-match'),
      });
      expect(denial).toBeTruthy();
    });

    it('is refused a batch where any one method escapes the scope', async () => {
      const { service } = build({ assignmentRole: 'DIRECTOR', grants: courtSeven });
      const denial = await service.gate({
        userContext: director,
        tournamentIds: [TID],
        requestedMethods: ['setMatchUpStatus', 'setMatchUpStatus'],
        methods: [...score('court7-match'), ...score('centre-match')],
      });
      expect(denial).toBeTruthy();
    });
  });

  it('refuses an expired grant even on a covered court', async () => {
    const expired = [
      { grantId: 'g1', scope: { courtIds: ['court-7'] }, capability: 'enterScores', notAfter: '2000-01-01T00:00:00Z' },
    ];
    const { service } = build({ assignmentRole: 'DIRECTOR', grants: expired });
    const denial = await service.gate({
      userContext: director,
      tournamentIds: [TID],
      requestedMethods: ['setMatchUpStatus'],
      methods: score('court7-match'),
    });
    expect(denial).toBe('Not authorized for this time window');
  });

  it('does not constrain a super-admin', async () => {
    const { service } = build({ grants: [{ grantId: 'g1', scope: { courtIds: ['court-7'] }, capability: 'enterScores' }] });
    const denial = await service.gate({
      userContext: superAdmin,
      tournamentIds: [TID],
      requestedMethods: ['setMatchUpStatus'],
      methods: score('centre-match'),
    });
    expect(denial).toBeNull();
  });

  it('a tournament-wide grant restricts nothing', async () => {
    const { service } = build({
      assignmentRole: 'DIRECTOR',
      grants: [{ grantId: 'g1', scope: {}, capability: 'enterScores' }],
    });
    const denial = await service.gate({
      userContext: director,
      tournamentIds: [TID],
      requestedMethods: ['setMatchUpStatus'],
      methods: score('centre-match'),
    });
    expect(denial).toBeNull();
  });

  it('falls through when grant storage is unavailable rather than denying everything', async () => {
    const { service, grantStorage } = build({ assignmentRole: 'DIRECTOR' });
    grantStorage.findForSubject.mockRejectedValueOnce(new Error('no such table'));
    const denial = await service.gate({
      userContext: director,
      tournamentIds: [TID],
      requestedMethods: ['setMatchUpStatus'],
      methods: score('centre-match'),
    });
    expect(denial).toBeNull();
  });
});
