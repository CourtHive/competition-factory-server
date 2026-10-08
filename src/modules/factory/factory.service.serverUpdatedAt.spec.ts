import { FactoryService } from './factory.service';

// P49: `serverUpdatedAt` is when a tournament's row was last written. The staleness probe and the fetch
// report it; it is as private as the record it describes.
const written = { t1: '2026-10-08T19:30:00.000Z', t2: '2026-10-08T19:31:00.000Z' };
const userContext: any = {
  userId: 'u-1',
  email: 'd@x.com',
  isSuperAdmin: false,
  globalRoles: ['client'],
  providerRoles: { p1: 'PROVIDER_ADMIN', p2: 'DIRECTOR' },
  providerIds: ['p1', 'p2'],
};

function build(storage: any) {
  const assignments: any = { getAssignedTournamentIds: vi.fn(async () => new Set()) };
  const none: any = {};
  return new FactoryService(storage, none, none, assignments, none, none, none, none, none);
}

describe('FactoryService — serverUpdatedAt', () => {
  const scoping = process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING;
  beforeEach(() => {
    process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING = 'true';
  });
  afterEach(() => {
    process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING = scoping;
  });

  it('a fetch drops the write time of a tournament the caller may not see, with the record', async () => {
    const storage: any = {
      fetchTournamentRecords: vi.fn(async () => ({
        success: true,
        tournamentRecords: {
          t1: { tournamentId: 't1', parentOrganisation: { organisationId: 'p1' } },
          // A director's tournament they neither created nor are assigned to.
          t2: { tournamentId: 't2', parentOrganisation: { organisationId: 'p2' } },
        },
        serverUpdatedAt: { ...written },
      })),
    };
    const result: any = await build(storage).fetchTournamentRecords(
      { tournamentIds: ['t1', 't2'] },
      undefined,
      userContext,
    );

    expect(Object.keys(result.tournamentRecords)).toEqual(['t1']);
    expect(result.serverUpdatedAt).toEqual({ t1: written.t1 });
  });

  it('the probe answers serverUpdatedAt beside the unchanged updatedAt', async () => {
    const storage: any = {
      fetchTournamentUpdatedAt: vi.fn(async () => ({
        success: true,
        tournamentId: 't1',
        updatedAt: null,
        serverUpdatedAt: written.t1,
        providerId: 'p1',
        extensions: [],
      })),
    };
    const result: any = await build(storage).fetchTournamentUpdatedAt({ tournamentId: 't1' }, undefined, userContext);
    expect(result).toEqual({ success: true, tournamentId: 't1', updatedAt: null, serverUpdatedAt: written.t1 });
  });
});
