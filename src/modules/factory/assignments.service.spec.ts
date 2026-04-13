import { AssignmentsService } from './assignments.service';

describe('AssignmentsService', () => {
  let service: AssignmentsService;
  let mockAssignmentStorage: any;
  let mockUserProviderStorage: any;
  let mockUserStorage: any;

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
      findByTournamentId: jest.fn().mockResolvedValue([]),
      findByUserId: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      grant: jest.fn().mockResolvedValue({ success: true }),
      revoke: jest.fn().mockResolvedValue({ success: true }),
    };
    mockUserProviderStorage = {
      findOne: jest.fn().mockResolvedValue({ userId: 'grantee-uuid', providerId: 'prov-1', providerRole: 'DIRECTOR' }),
      findByProviderId: jest.fn().mockResolvedValue([
        { userId: 'admin-uuid', providerId: 'prov-1', providerRole: 'PROVIDER_ADMIN', email: 'admin@test.com' },
        { userId: 'grantee-uuid', providerId: 'prov-1', providerRole: 'DIRECTOR', email: 'grantee@test.com' },
      ]),
    };
    mockUserStorage = {
      findOne: jest.fn().mockResolvedValue({ userId: 'grantee-uuid', email: 'grantee@test.com' }),
    };
    service = new AssignmentsService(mockAssignmentStorage, mockUserProviderStorage, mockUserStorage);
  });

  describe('list', () => {
    it('lists by tournamentId when provided', async () => {
      let result: any = await service.list({ tournamentId: 't-1' }, adminCtx);
      expect(result.success).toBe(true);
      expect(mockAssignmentStorage.findByTournamentId).toHaveBeenCalledWith('t-1');
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
      mockAssignmentStorage.findByUserId.mockResolvedValue([
        { tournamentId: 't-1' },
        { tournamentId: 't-2' },
      ]);
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
