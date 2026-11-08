import { AssignmentsService } from './assignments.service';

describe('AssignmentsService', () => {
  let service: AssignmentsService;
  let mockAssignmentStorage: any;
  let mockUserProviderStorage: any;
  let mockUserStorage: any;
  let mockTournamentStorageService: any;

  const adminCtx: any = {
    userId: 'admin-uuid',
    email: 'admin@test.com',
    isSuperAdmin: false,
    providerRoles: { 'prov-1': 'PROVIDER_ADMIN' },
    providerIds: ['prov-1'],
  };

  const superCtx: any = { ...adminCtx, isSuperAdmin: true };

  const directorCtx: any = {
    userId: 'dir-uuid',
    email: 'director@test.com',
    isSuperAdmin: false,
    providerRoles: { 'prov-1': 'DIRECTOR' },
    providerIds: ['prov-1'],
  };

  beforeEach(() => {
    mockAssignmentStorage = {
      findByTournamentId: vi.fn().mockResolvedValue([]),
      findByUserId: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue(null),
      grant: vi.fn().mockResolvedValue({ success: true }),
      revoke: vi.fn().mockResolvedValue({ success: true }),
    };
    mockUserProviderStorage = {
      findOne: vi.fn().mockResolvedValue({ userId: 'grantee-uuid', providerId: 'prov-1', providerRole: 'DIRECTOR' }),
      findByProviderId: vi.fn().mockResolvedValue([
        { userId: 'admin-uuid', providerId: 'prov-1', providerRole: 'PROVIDER_ADMIN', email: 'admin@test.com' },
        { userId: 'grantee-uuid', providerId: 'prov-1', providerRole: 'DIRECTOR', email: 'grantee@test.com' },
      ]),
    };
    mockUserStorage = {
      findOne: vi.fn().mockResolvedValue({ userId: 'grantee-uuid', email: 'grantee@test.com' }),
    };
    // The projection the service authorizes against: t-1 belongs to prov-1, t-other to prov-2.
    const owners: Record<string, string> = { 't-1': 'prov-1', 't-other': 'prov-2' };
    mockTournamentStorageService = {
      fetchTournamentUpdatedAt: vi.fn(async ({ tournamentId }: any) =>
        owners[tournamentId] ? { success: true, tournamentId, providerId: owners[tournamentId] } : { error: 'nf' },
      ),
    };
    service = new AssignmentsService(
      mockAssignmentStorage,
      mockUserProviderStorage,
      mockUserStorage,
      mockTournamentStorageService,
    );
  });

  describe('list', () => {
    it('lists by tournamentId when provided', async () => {
      let result: any = await service.list({ tournamentId: 't-1' }, adminCtx);
      expect(result.success).toBe(true);
      expect(mockAssignmentStorage.findByTournamentId).toHaveBeenCalledWith('t-1');
    });

    // Until 2026-11-08 the tournament form had no check: any authenticated token listed any tournament's staff.
    it("refuses a tournament's list to a director, and to another provider's admin", async () => {
      expect(await service.list({ tournamentId: 't-1' }, directorCtx)).toMatchObject({ error: expect.any(String) });
      expect(await service.list({ tournamentId: 't-other' }, adminCtx)).toMatchObject({ error: expect.any(String) });
      expect(mockAssignmentStorage.findByTournamentId).not.toHaveBeenCalled();
    });

    it("gives a super-admin any tournament's list, and refuses an unknown tournament", async () => {
      expect(await service.list({ tournamentId: 't-other' }, superCtx)).toMatchObject({ success: true });
      expect(await service.list({ tournamentId: 'missing' }, superCtx)).toMatchObject({ error: expect.any(String) });
    });

    it('lists by userId when no tournamentId', async () => {
      let result: any = await service.list({}, adminCtx);
      expect(result.success).toBe(true);
      expect(mockAssignmentStorage.findByUserId).toHaveBeenCalledWith('admin-uuid');
    });
  });

  describe('grant', () => {
    it('grants access when grantor is PROVIDER_ADMIN', async () => {
      let result: any = await service.grant(
        { tournamentId: 't-1', userEmail: 'grantee@test.com', providerId: 'prov-1' },
        adminCtx,
      );
      expect(result.success).toBe(true);
      expect(result.assignment.tournamentId).toBe('t-1');
      expect(result.assignment.userId).toBe('grantee-uuid');
      expect(mockAssignmentStorage.grant).toHaveBeenCalled();
    });

    it('grants access when grantor is SUPER_ADMIN', async () => {
      let result: any = await service.grant(
        { tournamentId: 't-1', userEmail: 'grantee@test.com', providerId: 'prov-1' },
        superCtx,
      );
      expect(result.success).toBe(true);
    });

    it('rejects when grantor is DIRECTOR (not PROVIDER_ADMIN)', async () => {
      let result: any = await service.grant(
        { tournamentId: 't-1', userEmail: 'grantee@test.com', providerId: 'prov-1' },
        directorCtx,
      );
      expect(result.error).toContain('Insufficient permissions');
      expect(mockAssignmentStorage.grant).not.toHaveBeenCalled();
    });

    it('rejects when grantee user not found', async () => {
      mockUserStorage.findOne.mockResolvedValue(null);
      let result: any = await service.grant(
        { tournamentId: 't-1', userEmail: 'nobody@test.com', providerId: 'prov-1' },
        adminCtx,
      );
      expect(result.error).toBe('User not found');
    });

    it('rejects when grantee has no user_providers row for the provider', async () => {
      mockUserProviderStorage.findOne.mockResolvedValue(null);
      let result: any = await service.grant(
        { tournamentId: 't-1', userEmail: 'grantee@test.com', providerId: 'prov-1' },
        adminCtx,
      );
      expect(result.error).toContain('not associated with this provider');
    });

    it('rejects when grantee has no userId', async () => {
      mockUserStorage.findOne.mockResolvedValue({ email: 'grantee@test.com' });
      let result: any = await service.grant(
        { tournamentId: 't-1', userEmail: 'grantee@test.com', providerId: 'prov-1' },
        adminCtx,
      );
      expect(result.error).toContain('no UUID');
    });
  });

  describe('revoke', () => {
    it('revokes access when grantor is PROVIDER_ADMIN', async () => {
      let result: any = await service.revoke(
        { tournamentId: 't-1', userEmail: 'grantee@test.com', providerId: 'prov-1' },
        adminCtx,
      );
      expect(result.success).toBe(true);
      expect(mockAssignmentStorage.revoke).toHaveBeenCalled();
    });

    it('rejects when grantor is DIRECTOR', async () => {
      let result: any = await service.revoke(
        { tournamentId: 't-1', userEmail: 'grantee@test.com', providerId: 'prov-1' },
        directorCtx,
      );
      expect(result.error).toContain('Insufficient permissions');
    });
  });

  // The provider an assignment route authorizes against is the TOURNAMENT's, never the one the caller sends.
  describe("another provider's tournament", () => {
    const attack = { tournamentId: 't-other', userEmail: 'grantee@test.com', providerId: 'prov-1' };

    it("refuses a grant onto it, even naming the admin's own provider", async () => {
      expect(await service.grant(attack, adminCtx)).toMatchObject({ error: expect.any(String) });
      expect(mockAssignmentStorage.grant).not.toHaveBeenCalled();
    });

    it("refuses a revoke from it, even naming the admin's own provider", async () => {
      expect(await service.revoke(attack, adminCtx)).toMatchObject({ error: expect.any(String) });
      expect(mockAssignmentStorage.revoke).not.toHaveBeenCalled();
    });

    it("refuses its own provider's admin a claim that names a different provider", async () => {
      const otherAdmin: any = { ...adminCtx, providerRoles: { 'prov-2': 'PROVIDER_ADMIN' }, providerIds: ['prov-2'] };
      expect(await service.revoke(attack, otherAdmin)).toMatchObject({
        error: expect.stringContaining('not the provider'),
      });
    });

    it('records the grant against the owning provider', async () => {
      const result: any = await service.grant({ tournamentId: 't-1', userEmail: 'grantee@test.com' } as any, adminCtx);
      expect(result.success).toBe(true);
      expect(mockAssignmentStorage.grant).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'prov-1' }));
    });
  });

  describe('eligibleUsers', () => {
    it('returns provider users when grantor is PROVIDER_ADMIN', async () => {
      let result: any = await service.eligibleUsers({ providerId: 'prov-1' }, adminCtx);
      expect(result.success).toBe(true);
      expect(result.users).toHaveLength(2);
      expect(result.users[0].email).toBe('admin@test.com');
    });

    it('rejects when grantor is DIRECTOR', async () => {
      let result: any = await service.eligibleUsers({ providerId: 'prov-1' }, directorCtx);
      expect(result.error).toContain('Insufficient permissions');
    });
  });

  describe('getAssignedTournamentIds', () => {
    it('returns a set of tournament IDs', async () => {
      mockAssignmentStorage.findByUserId.mockResolvedValue([{ tournamentId: 't-1' }, { tournamentId: 't-2' }]);
      let result: any = await service.getAssignedTournamentIds('user-uuid');
      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(2);
      expect(result.has('t-1')).toBe(true);
    });

    it('returns empty set when storage throws (LevelDB fallback)', async () => {
      mockAssignmentStorage.findByUserId.mockRejectedValue(new Error('requires Postgres'));
      let result: any = await service.getAssignedTournamentIds('user-uuid');
      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
    });
  });
});
