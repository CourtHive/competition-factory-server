import { GrantsService } from './grants.service';

function build(rows: any[] | Error) {
  const grantStorage: any = {
    findForSubject: rows instanceof Error ? vi.fn().mockRejectedValue(rows) : vi.fn().mockResolvedValue(rows),
  };
  return { service: new GrantsService(grantStorage, {} as any, {} as any, {} as any), grantStorage };
}

const ctx: any = { userId: 'u1' };

describe('GrantsService.forCaller', () => {
  it('returns the caller live grants in client shape', async () => {
    const { service } = build([
      { grantId: 'g1', userId: 'u1', capability: 'canEnterScores', scope: { courtIds: ['c7'] } },
    ]);
    const grants = await service.forCaller('t1', ctx);
    expect(grants).toEqual([
      { capability: 'canEnterScores', scope: { courtIds: ['c7'] }, notBefore: undefined, notAfter: undefined },
    ]);
  });

  // The client must not re-implement the window check — that would be a second
  // place for it to drift from the gate.
  it('filters out expired and not-yet-live grants rather than shipping their windows', async () => {
    const { service } = build([
      { capability: 'canEnterScores', scope: {}, notAfter: '2000-01-01T00:00:00Z' },
      { capability: 'canModifySchedule', scope: {}, notBefore: '2999-01-01T00:00:00Z' },
      { capability: 'canPublish', scope: {} },
    ]);
    const grants = await service.forCaller('t1', ctx);
    expect(grants.map((g) => g.capability)).toEqual(['canPublish']);
  });

  it('returns nothing without a user context or tournament', async () => {
    const { service, grantStorage } = build([]);
    expect(await service.forCaller('t1', undefined)).toEqual([]);
    expect(await service.forCaller('', ctx)).toEqual([]);
    expect(grantStorage.findForSubject).not.toHaveBeenCalled();
  });

  // Empty is "unrestricted by this mechanism", matching what the gate concludes.
  it('returns empty when storage is unavailable rather than implying a lockdown', async () => {
    const { service } = build(new Error('relation "tournament_grants" does not exist'));
    expect(await service.forCaller('t1', ctx)).toEqual([]);
  });
});

// ── write API ──

const TOURNAMENT_WITH_PROVIDER = {
  tournamentRecords: { t1: { tournamentId: 't1', parentOrganisation: { organisationId: 'P1' } } },
};

function buildWritable(overrides: any = {}) {
  const grantStorage: any = {
    findForSubject: vi.fn().mockResolvedValue([]),
    findByTournamentId: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ grantId: 'g-new' }),
    revoke: vi.fn().mockResolvedValue({ success: true }),
    ...overrides.grantStorage,
  };
  const userProviderStorage: any = {
    findOne: vi.fn().mockResolvedValue({ userId: 'u2', providerId: 'P1', providerRole: 'DIRECTOR' }),
    findByProviderId: vi.fn().mockResolvedValue([{ userId: 'u2', email: 'vol@example.com' }]),
    ...overrides.userProviderStorage,
  };
  const userStorage: any = {
    findOne: vi.fn().mockResolvedValue({ userId: 'u2', email: 'vol@example.com' }),
    ...overrides.userStorage,
  };
  const tournamentStorageService: any = {
    fetchTournamentRecords: vi.fn().mockResolvedValue(overrides.records ?? TOURNAMENT_WITH_PROVIDER),
  };
  const service = new GrantsService(grantStorage, userProviderStorage, userStorage, tournamentStorageService);
  return { service, grantStorage, userProviderStorage, userStorage, tournamentStorageService };
}

const providerAdmin: any = { userId: 'admin-1', isSuperAdmin: false, providerRoles: { P1: 'PROVIDER_ADMIN' } };
const otherProviderAdmin: any = { userId: 'admin-2', isSuperAdmin: false, providerRoles: { P2: 'PROVIDER_ADMIN' } };
const director: any = { userId: 'dir-1', isSuperAdmin: false, providerRoles: { P1: 'DIRECTOR' } };
const superAdmin: any = { userId: 'root', isSuperAdmin: true, providerRoles: {} };

const validGrant = {
  tournamentId: 't1',
  userEmail: 'vol@example.com',
  capability: 'canEnterScores',
  scope: { courtIds: ['court-7'] },
  notAfter: '2999-01-01T00:00:00Z',
};

describe('GrantsService.create', () => {
  it('writes the row with the provider read from the tournament record', async () => {
    const { service, grantStorage } = buildWritable();
    const result: any = await service.create(validGrant, providerAdmin);

    expect(result).toEqual({ success: true, grantId: 'g-new' });
    expect(grantStorage.create).toHaveBeenCalledWith({
      tournamentId: 't1',
      userId: 'u2',
      providerId: 'P1',
      capability: 'canEnterScores',
      scope: { courtIds: ['court-7'] },
      notBefore: null,
      notAfter: '2999-01-01T00:00:00Z',
      grantedBy: 'admin-1',
    });
  });

  it('defaults an omitted scope to tournament-wide', async () => {
    const { service, grantStorage } = buildWritable();
    await service.create({ ...validGrant, scope: undefined }, providerAdmin);
    expect(grantStorage.create.mock.calls[0][0].scope).toEqual({});
  });

  it('lets a super-admin grant on any provider', async () => {
    const { service, grantStorage } = buildWritable();
    expect(await service.create(validGrant, superAdmin)).toEqual({ success: true, grantId: 'g-new' });
    expect(grantStorage.create).toHaveBeenCalledTimes(1);
  });

  // The provider is never taken from the request, so administering SOME
  // provider is not administering this tournament's.
  it('refuses an admin of a different provider', async () => {
    const { service, grantStorage } = buildWritable();
    const result: any = await service.create(validGrant, otherProviderAdmin);
    expect(result.error).toMatch(/Insufficient permissions/);
    expect(grantStorage.create).not.toHaveBeenCalled();
  });

  it('refuses a DIRECTOR at the right provider', async () => {
    const { service, grantStorage } = buildWritable();
    expect(((await service.create(validGrant, director)) as any).error).toMatch(/Insufficient permissions/);
    expect(grantStorage.create).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated caller', async () => {
    const { service, grantStorage } = buildWritable();
    expect(((await service.create(validGrant, undefined)) as any).error).toMatch(/Insufficient permissions/);
    expect(grantStorage.create).not.toHaveBeenCalled();
  });

  // Authorization precedes every lookup, so a refused caller cannot use this
  // route to discover whether an address is registered.
  it('does not look the grantee up before authorizing', async () => {
    const { service, userStorage } = buildWritable();
    await service.create(validGrant, otherProviderAdmin);
    expect(userStorage.findOne).not.toHaveBeenCalled();
  });

  it('refuses a tournament with no owning provider rather than defaulting one', async () => {
    const { service, grantStorage } = buildWritable({
      records: { tournamentRecords: { t1: { tournamentId: 't1' } } },
    });
    expect(((await service.create(validGrant, superAdmin)) as any).error).toMatch(/no owning provider/);
    expect(grantStorage.create).not.toHaveBeenCalled();
  });

  it('refuses an unknown tournament', async () => {
    const { service, grantStorage } = buildWritable({ records: { tournamentRecords: {} } });
    expect(((await service.create(validGrant, superAdmin)) as any).error).toMatch(/Tournament not found/);
    expect(grantStorage.create).not.toHaveBeenCalled();
  });

  // The gate would refuse an unevaluable scope on every mutation, forever. It
  // must not be storable.
  it('refuses an unevaluable scope at write time', async () => {
    const { service, grantStorage } = buildWritable();
    const result: any = await service.create({ ...validGrant, scope: { courtId: ['court-7'] } as any }, providerAdmin);
    expect(result.error).toMatch(/unknown scope key/);
    expect(grantStorage.create).not.toHaveBeenCalled();
  });

  it('refuses a capability that is not a permission key', async () => {
    const { service, grantStorage } = buildWritable();
    expect(((await service.create({ ...validGrant, capability: 'RECORDER' }, providerAdmin)) as any).error).toMatch(
      /unknown capability/,
    );
    expect(grantStorage.create).not.toHaveBeenCalled();
  });

  it('refuses a window that has already closed', async () => {
    const { service, grantStorage } = buildWritable();
    const result: any = await service.create({ ...validGrant, notAfter: '2000-01-01T00:00:00Z' }, providerAdmin);
    expect(result.error).toMatch(/already in the past/);
    expect(grantStorage.create).not.toHaveBeenCalled();
  });

  it('refuses a grantee who is not associated with the provider', async () => {
    const { service, grantStorage } = buildWritable({
      userProviderStorage: { findOne: vi.fn().mockResolvedValue(null) },
    });
    expect(((await service.create(validGrant, providerAdmin)) as any).error).toMatch(
      /not associated with this provider/,
    );
    expect(grantStorage.create).not.toHaveBeenCalled();
  });

  it('refuses an unknown grantee', async () => {
    const { service, grantStorage } = buildWritable({ userStorage: { findOne: vi.fn().mockResolvedValue(null) } });
    expect(((await service.create(validGrant, providerAdmin)) as any).error).toBe('User not found');
    expect(grantStorage.create).not.toHaveBeenCalled();
  });

  it('requires a tournament and a grantee', async () => {
    const { service, tournamentStorageService } = buildWritable();
    expect(((await service.create({ ...validGrant, tournamentId: '' }, providerAdmin)) as any).error).toMatch(
      /tournamentId is required/,
    );
    expect(((await service.create({ ...validGrant, userEmail: '' }, providerAdmin)) as any).error).toMatch(
      /userEmail is required/,
    );
    expect(tournamentStorageService.fetchTournamentRecords).not.toHaveBeenCalled();
  });
});

describe('GrantsService.revoke', () => {
  const row = { grantId: 'g1', tournamentId: 't1', providerId: 'P1', capability: 'canEnterScores', scope: {} };
  const GRANT_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

  it('revokes when the caller administers the grant own provider', async () => {
    const { service, grantStorage } = buildWritable({
      grantStorage: { findById: vi.fn().mockResolvedValue(row) },
    });
    expect(await service.revoke(GRANT_ID, providerAdmin)).toEqual({ success: true });
    expect(grantStorage.revoke).toHaveBeenCalledWith(GRANT_ID);
  });

  // Authorization reads provider_id off the row, so administering another
  // provider does not reach this grant.
  it('refuses an admin of a different provider', async () => {
    const { service, grantStorage } = buildWritable({
      grantStorage: { findById: vi.fn().mockResolvedValue(row) },
    });
    expect(((await service.revoke(GRANT_ID, otherProviderAdmin)) as any).error).toMatch(/Insufficient permissions/);
    expect(grantStorage.revoke).not.toHaveBeenCalled();
  });

  it('reports a malformed id as not found without querying', async () => {
    const { service, grantStorage } = buildWritable();
    expect(((await service.revoke('not-a-uuid', superAdmin)) as any).error).toBe('Grant not found');
    expect(grantStorage.findById).not.toHaveBeenCalled();
    expect(grantStorage.revoke).not.toHaveBeenCalled();
  });

  it('reports a missing grant as not found', async () => {
    const { service, grantStorage } = buildWritable();
    expect(((await service.revoke(GRANT_ID, superAdmin)) as any).error).toBe('Grant not found');
    expect(grantStorage.revoke).not.toHaveBeenCalled();
  });
});

describe('GrantsService.listForTournament', () => {
  const rows = [
    { grantId: 'g1', tournamentId: 't1', userId: 'u2', providerId: 'P1', capability: 'canEnterScores', scope: {} },
    {
      grantId: 'g2',
      tournamentId: 't1',
      userId: 'u3',
      providerId: 'P1',
      capability: '*',
      scope: {},
      notAfter: '2000-01-01T00:00:00Z',
    },
  ];

  it('returns the grants with grantee emails and a live flag', async () => {
    const { service } = buildWritable({ grantStorage: { findByTournamentId: vi.fn().mockResolvedValue(rows) } });
    const result: any = await service.listForTournament('t1', providerAdmin);

    expect(result.success).toBe(true);
    expect(result.grants).toHaveLength(2);
    expect(result.grants[0]).toMatchObject({ grantId: 'g1', email: 'vol@example.com', live: true });
    // Expired rows are listed, not hidden — an operator managing access needs to
    // see a grant that has lapsed in order to replace it.
    expect(result.grants[1]).toMatchObject({ grantId: 'g2', email: undefined, live: false });
  });

  it('refuses an admin of a different provider', async () => {
    const { service, grantStorage } = buildWritable();
    expect(((await service.listForTournament('t1', otherProviderAdmin)) as any).error).toMatch(
      /Insufficient permissions/,
    );
    expect(grantStorage.findByTournamentId).not.toHaveBeenCalled();
  });

  it('refuses an unknown tournament', async () => {
    const { service } = buildWritable({ records: { tournamentRecords: {} } });
    expect(((await service.listForTournament('t1', providerAdmin)) as any).error).toMatch(/Tournament not found/);
  });
});
