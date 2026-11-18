import { MutationAuthorizationService } from './mutation-authorization.service';
import { CREATED_BY_USER_ID } from './helpers/checkTournamentAccess';
import { FactoryController } from './factory.controller';

// Scoping is ON in prod (ENABLE_TOURNAMENT_ACCESS_SCOPING=true); the per-tournament gate has nothing to say without it.
vi.mock('src/common/constants/feature-flags', () => ({
  isTournamentAccessScopingEnabled: () => true,
}));

// POST /factory/score and POST /factory/matchups were guarded by @Roles([SCORE, SUPER_ADMIN]) alone. Every provisioner
// and provider API key holds SCORE, so any of them could score — or read the matchUps of — ANY provider's tournament
// given its ids. The score route now runs the same gate as POST /factory (real gate below, storage stubbed); the
// matchups route runs the /factory/fetch read gates.

const TID = 't-1';
const OWNER = 'prov-owner';
const OTHER = 'prov-other';

const record = {
  tournamentId: TID,
  parentOrganisation: { organisationId: OWNER },
  extensions: [{ name: CREATED_BY_USER_ID, value: 'someone-else' }],
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
                { matchUpId: 'court7-match', schedule: { courtId: 'court-7', scheduledDate: '2026-11-18' } },
                { matchUpId: 'centre-match', schedule: { courtId: 'centre', scheduledDate: '2026-11-18' } },
              ],
            },
          ],
        },
      ],
    },
  ],
};

function build({ grants = [] }: { grants?: any[] } = {}) {
  const tournamentStorageService: any = {
    fetchTournamentRecords: vi.fn(async () => ({ tournamentRecords: { [TID]: record } })),
    fetchTournamentUpdatedAt: vi.fn(async ({ tournamentId }: { tournamentId: string }) =>
      tournamentId === TID
        ? { success: true, tournamentId, providerId: OWNER, extensions: record.extensions }
        : { error: 'MISSING_TOURNAMENT_RECORD' },
    ),
  };
  const gate = new MutationAuthorizationService(
    { getProvider: vi.fn().mockResolvedValue({ providerConfigCaps: {}, providerConfigSettings: {} }) } as any,
    { findForSubject: vi.fn().mockResolvedValue(grants) } as any,
    tournamentStorageService,
    { getAssignedRoles: vi.fn().mockResolvedValue(new Map()) } as any,
  );
  const service: any = {
    score: vi.fn(async () => ({ success: true, publicNotices: [] })),
    getMatchUps: vi.fn(async () => ({ matchUps: [] })),
    canReadUnpublishedTournament: vi.fn(async () => true),
  };
  const broadcast: any = { broadcastMutation: vi.fn(), broadcastPublicNotices: vi.fn() };
  const cache: any = { get: vi.fn(), set: vi.fn(), del: vi.fn() };
  const controller = new FactoryController(service, broadcast, gate, {} as any, cache);
  return { controller, service, cache };
}

// A provisioner key's synthetic context, as provisioner.middleware builds it: it acts for the X-Provider-Id it named.
const provisionerKey = (providerId: string) => ({
  userId: 'provisioner:prov-key',
  email: 'provisioner@Integrator',
  isSuperAdmin: false,
  globalRoles: ['client', 'generate', 'score'],
  providerRoles: { [providerId]: 'PROVIDER_ADMIN' },
  providerIds: [providerId],
  provisionerProviderIds: [],
  actingProviderId: providerId,
});

const scoreBody = (matchUpId = 'court7-match') => ({
  params: { tournamentId: TID, drawId: 'd1', matchUpId, outcome: { winningSide: 1 } },
});
const req = (userContext?: any) => ({ user: userContext ? { email: userContext.email } : undefined });

describe('POST /factory/score — per-tournament authorization', () => {
  it('refuses a provisioner key acting for another provider, and never reaches the engine', async () => {
    const { controller, service } = build();
    const ctx = provisionerKey(OTHER);
    await expect(controller.scoreMatchUp(scoreBody() as any, req(ctx), ctx as any)).rejects.toThrow(
      'Not authorized to modify this tournament',
    );
    expect(service.score).not.toHaveBeenCalled();
  });

  it("scores for a provisioner key acting for the tournament's owning provider", async () => {
    const { controller, service } = build();
    const ctx = provisionerKey(OWNER);
    await controller.scoreMatchUp(scoreBody() as any, req(ctx), ctx as any);
    expect(service.score).toHaveBeenCalledTimes(1);
  });

  it("refuses a user session acting for one provider on another provider's tournament", async () => {
    // HiveID gives a single-association user a session acting for that provider; such a token scored other
    // providers' tournaments through this route.
    const { controller, service } = build();
    const ctx = {
      userId: 'user-1',
      email: 'staff@example.com',
      isSuperAdmin: false,
      providerRoles: { [OTHER]: 'PROVIDER_ADMIN' },
      providerIds: [OTHER],
      actingProviderId: OTHER,
    };
    await expect(controller.scoreMatchUp(scoreBody() as any, req(ctx), ctx as any)).rejects.toThrow(
      'Not authorized to modify this tournament',
    );
    expect(service.score).not.toHaveBeenCalled();
  });

  it('holds a Court-7 scoring grant to Court 7 on this route too', async () => {
    const { controller, service } = build({
      grants: [{ grantId: 'g1', scope: { courtIds: ['court-7'] }, capability: 'canEnterScores' }],
    });
    const ctx = {
      userId: 'user-2',
      email: 'court7@example.com',
      isSuperAdmin: false,
      providerRoles: { [OWNER]: 'PROVIDER_ADMIN' },
      providerIds: [OWNER],
      actingProviderId: OWNER,
    };
    await expect(controller.scoreMatchUp(scoreBody('centre-match') as any, req(ctx), ctx as any)).rejects.toThrow();
    expect(service.score).not.toHaveBeenCalled();
    await controller.scoreMatchUp(scoreBody('court7-match') as any, req(ctx), ctx as any);
    expect(service.score).toHaveBeenCalledTimes(1);
  });

  it("passes the relay's service token, which carries no userContext (aud 'score')", async () => {
    // score-relay authorizes each tracker against its tournament before forwarding; its token is aud 'score', for
    // which auth.middleware builds no userContext.
    const { controller, service } = build();
    await controller.scoreMatchUp(scoreBody() as any, { user: { email: 'relay-service@courthive.net' } }, undefined);
    expect(service.score).toHaveBeenCalledTimes(1);
  });
});

describe('POST /factory/matchups — read authorization', () => {
  it('refuses a caller who could not fetch the tournament, before the cache is consulted', async () => {
    const { controller, service, cache } = build();
    service.canReadUnpublishedTournament.mockResolvedValue(false);
    const ctx = provisionerKey(OTHER);
    await expect(
      controller.getMatchUps({ tournamentId: TID } as any, { email: ctx.email }, ctx as any),
    ).rejects.toThrow('Not authorized to read this tournament');
    expect(service.canReadUnpublishedTournament).toHaveBeenCalledWith(TID, { email: ctx.email }, ctx);
    expect(cache.get).not.toHaveBeenCalled();
    expect(service.getMatchUps).not.toHaveBeenCalled();
  });

  it('serves a caller who may read the tournament', async () => {
    const { controller, service } = build();
    const ctx = provisionerKey(OWNER);
    await controller.getMatchUps({ tournamentId: TID } as any, { email: ctx.email }, ctx as any);
    expect(service.getMatchUps).toHaveBeenCalledTimes(1);
  });
});
