import { Logger, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';

describe('AuthService', () => {
  let authService: AuthService;
  let mockUsersService: any;
  let jwtService: JwtService;
  let mockEmailService: any;
  let mockConfigService: any;
  let mockProviderStorage: any;
  let mockUserStorage: any;
  let mockUserProviderStorage: any;
  let mockProvisionerProviderStorage: any;

  beforeEach(() => {
    jwtService = new JwtService({ secret: 'test-secret' });

    mockUsersService = {
      findOne: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      remove: jest.fn(),
    };

    mockEmailService = {
      sendTemplated: jest.fn().mockResolvedValue({ id: 'msg-123' }),
    };

    mockConfigService = {
      get: jest.fn().mockReturnValue({ baseUrl: 'https://nest.test.example' }),
    };

    mockProviderStorage = {
      getProvider: jest.fn(),
      updateLastAccess: jest.fn().mockResolvedValue(undefined),
    };

    mockUserStorage = {
      update: jest.fn(),
      updateLastAccess: jest.fn().mockResolvedValue(undefined),
      updateLastSelectedProviderId: jest.fn().mockResolvedValue({ success: true }),
      completeFirstLogin: jest.fn().mockResolvedValue({ success: true }),
      findByContactEmail: jest.fn().mockResolvedValue(null),
      findByUserId: jest.fn().mockResolvedValue(null),
      setPasswordByUserId: jest.fn().mockResolvedValue({ success: true }),
      setContactEmail: jest.fn().mockResolvedValue({ success: true }),
      markEmailVerified: jest.fn().mockResolvedValue({ success: true }),
    };

    const mockUserProvisionerStorage = {
      findProvisionerIdsByUser: jest.fn().mockResolvedValue([]),
      findUsersByProvisioner: jest.fn().mockResolvedValue([]),
      associate: jest.fn().mockResolvedValue({ success: true }),
      disassociate: jest.fn().mockResolvedValue({ success: true }),
    };

    mockUserProviderStorage = {
      findByUserId: jest.fn().mockResolvedValue([]),
      findByUserIdEnriched: jest.fn().mockResolvedValue([]),
      findByEmail: jest.fn().mockResolvedValue([]),
      findByProviderId: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({ success: true }),
      remove: jest.fn().mockResolvedValue({ success: true }),
    };

    mockProvisionerProviderStorage = {
      findByProvisioner: jest.fn().mockResolvedValue([]),
      findByProvider: jest.fn().mockResolvedValue([]),
      getRelationship: jest.fn().mockResolvedValue(null),
      associate: jest.fn(),
      updateRelationship: jest.fn(),
      disassociate: jest.fn(),
    };

    authService = new AuthService(
      mockUsersService,
      jwtService,
      mockEmailService,
      mockConfigService,
      mockProviderStorage,
      mockUserStorage,
      mockUserProvisionerStorage as any,
      mockUserProviderStorage,
      mockProvisionerProviderStorage,
    );
  });

  describe('canAccessApiDocs', () => {
    const hash = (p: string) => bcrypt.hash(p, 10);

    it('allows a super-admin', async () => {
      mockUsersService.findOne.mockResolvedValue({ email: 'sa@test.com', userId: 'u1', password: await hash('pw'), roles: ['superadmin'] });
      await expect(authService.canAccessApiDocs('sa@test.com', 'pw')).resolves.toBe(true);
    });

    it('allows a provisioner-role user', async () => {
      mockUsersService.findOne.mockResolvedValue({ email: 'pv@test.com', userId: 'u1', password: await hash('pw'), roles: ['provisioner'] });
      await expect(authService.canAccessApiDocs('pv@test.com', 'pw')).resolves.toBe(true);
    });

    it('allows a PROVIDER_ADMIN of some provider', async () => {
      mockUsersService.findOne.mockResolvedValue({ email: 'pa@test.com', userId: 'u1', password: await hash('pw'), roles: ['client'] });
      mockUserProviderStorage.findByUserId.mockResolvedValue([{ providerId: 'p1', providerRole: 'PROVIDER_ADMIN' }]);
      await expect(authService.canAccessApiDocs('pa@test.com', 'pw')).resolves.toBe(true);
    });

    it('allows a legacy admin via the admin → PROVIDER_ADMIN shim', async () => {
      mockUsersService.findOne.mockResolvedValue({ email: 'la@test.com', userId: 'u1', password: await hash('pw'), roles: ['admin'], providerId: 'p1' });
      await expect(authService.canAccessApiDocs('la@test.com', 'pw')).resolves.toBe(true);
    });

    it('rejects a client-only user', async () => {
      mockUsersService.findOne.mockResolvedValue({ email: 'cl@test.com', userId: 'u1', password: await hash('pw'), roles: ['client'] });
      await expect(authService.canAccessApiDocs('cl@test.com', 'pw')).resolves.toBe(false);
    });

    it('rejects a wrong password', async () => {
      mockUsersService.findOne.mockResolvedValue({ email: 'sa@test.com', userId: 'u1', password: await hash('pw'), roles: ['superadmin'] });
      await expect(authService.canAccessApiDocs('sa@test.com', 'nope')).resolves.toBe(false);
    });

    it('rejects an SSO-only (passwordless) account', async () => {
      mockUsersService.findOne.mockResolvedValue({ email: 'sso@test.com', userId: 'u1', password: '', roles: ['superadmin'] });
      await expect(authService.canAccessApiDocs('sso@test.com', 'pw')).resolves.toBe(false);
    });

    it('rejects an unknown account', async () => {
      mockUsersService.findOne.mockResolvedValue(null);
      await expect(authService.canAccessApiDocs('nobody@test.com', 'pw')).resolves.toBe(false);
    });

    it('rejects when email or password is missing', async () => {
      await expect(authService.canAccessApiDocs('', 'pw')).resolves.toBe(false);
      await expect(authService.canAccessApiDocs('a@test.com', '')).resolves.toBe(false);
    });
  });

  describe('signIn', () => {
    it('throws UnauthorizedException when email is empty', async () => {
      await expect(authService.signIn('', 'password')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when user not found', async () => {
      mockUsersService.findOne.mockResolvedValue(null);
      await expect(authService.signIn('test@test.com', 'password')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when password does not match', async () => {
      const hashed = await bcrypt.hash('correct-password', 10);
      mockUsersService.findOne.mockResolvedValue({ email: 'test@test.com', password: hashed, roles: ['client'] });
      await expect(authService.signIn('test@test.com', 'wrong-password')).rejects.toThrow(UnauthorizedException);
    });

    it('returns token for valid cleartext password match', async () => {
      mockUsersService.findOne.mockResolvedValue({ email: 'test@test.com', password: 'secret', roles: ['client'] });
      const result = await authService.signIn('test@test.com', 'secret');
      expect(result.token).toBeDefined();
      expect(typeof result.token).toBe('string');
    });

    it('returns token for valid bcrypt password match', async () => {
      const hashed = await bcrypt.hash('my-password', 10);
      mockUsersService.findOne.mockResolvedValue({ email: 'test@test.com', password: hashed, roles: ['admin'] });
      const result = await authService.signIn('test@test.com', 'my-password');
      expect(result.token).toBeDefined();
    });

    it('enriches user details with provider when providerId exists', async () => {
      const provider = { organisationName: 'TestOrg' };
      mockUsersService.findOne.mockResolvedValue({
        email: 'admin@test.com',
        password: 'pass',
        roles: ['admin'],
        providerId: 'p1',
      });
      mockProviderStorage.getProvider.mockResolvedValue(provider);

      const result = await authService.signIn('admin@test.com', 'pass');
      expect(mockProviderStorage.getProvider).toHaveBeenCalledWith('p1');
      expect(result.token).toBeDefined();
    });

    it('updates lastAccess for both user and provider on successful login', async () => {
      mockUsersService.findOne.mockResolvedValue({
        email: 'la@test.com', password: 'pass', roles: ['admin'], providerId: 'p1',
      });
      mockProviderStorage.getProvider.mockResolvedValue({ organisationName: 'O' });

      await authService.signIn('la@test.com', 'pass');
      // flush fire-and-forget .catch handlers
      await Promise.resolve();

      expect(mockUserStorage.updateLastAccess).toHaveBeenCalledWith('la@test.com');
      expect(mockProviderStorage.updateLastAccess).toHaveBeenCalledWith('p1');
    });

    it('logs (but does not throw) when updateLastAccess fails', async () => {
      mockUsersService.findOne.mockResolvedValue({
        email: 'fail@test.com', password: 'pass', roles: ['client'], providerId: 'p1',
      });
      mockProviderStorage.getProvider.mockResolvedValue({});
      mockUserStorage.updateLastAccess.mockRejectedValueOnce(new Error('db down'));
      mockProviderStorage.updateLastAccess.mockRejectedValueOnce(new Error('db down'));
      const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);

      const result = await authService.signIn('fail@test.com', 'pass');
      // both .catch handlers run on the next microtask — flush a few times
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(result.token).toBeDefined();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('embeds providerAssociations[] and lastSelectedProviderId in the JWT', async () => {
      mockUsersService.findOne.mockResolvedValue({
        userId: 'u-1',
        email: 'multi@test.com',
        password: 'secret',
        providerId: 'prov-ION',
        lastSelectedProviderId: 'prov-BOBOCA',
        roles: ['client'],
      });
      mockUserProviderStorage.findByUserIdEnriched.mockResolvedValue([
        { userId: 'u-1', providerId: 'prov-ION', providerRole: 'PROVIDER_ADMIN', organisationName: 'ION', organisationAbbreviation: 'ION' },
        { userId: 'u-1', providerId: 'prov-BOBOCA', providerRole: 'PROVIDER_ADMIN', organisationName: 'Battle of Boca', organisationAbbreviation: 'BOBOCA' },
      ]);
      const result: any = await authService.signIn('multi@test.com', 'secret');
      const decoded = await jwtService.verifyAsync(result.token);
      expect(decoded.providerAssociations).toHaveLength(2);
      expect(decoded.providerAssociations[0].organisationAbbreviation).toBe('ION');
      expect(decoded.lastSelectedProviderId).toBe('prov-BOBOCA');
    });

    it('nullifies lastSelectedProviderId when it is no longer a current association', async () => {
      mockUsersService.findOne.mockResolvedValue({
        userId: 'u-2',
        email: 'stale@test.com',
        password: 'secret',
        providerId: 'prov-ION',
        lastSelectedProviderId: 'prov-REVOKED',
        roles: ['client'],
      });
      mockUserProviderStorage.findByUserIdEnriched.mockResolvedValue([
        { userId: 'u-2', providerId: 'prov-ION', providerRole: 'PROVIDER_ADMIN', organisationName: 'ION', organisationAbbreviation: 'ION' },
      ]);
      const result: any = await authService.signIn('stale@test.com', 'secret');
      const decoded = await jwtService.verifyAsync(result.token);
      expect(decoded.lastSelectedProviderId).toBeNull();
    });

    it('returns a limited token when user.mustChangePassword=true', async () => {
      mockUsersService.findOne.mockResolvedValue({
        email: 'fresh@test.com',
        password: 'temp-pass',
        roles: ['client'],
        mustChangePassword: true,
      });
      const result: any = await authService.signIn('fresh@test.com', 'temp-pass');
      expect(result.mustChangePassword).toBe(true);
      expect(typeof result.limitedToken).toBe('string');
      expect(result.token).toBeUndefined();
      // The provider load + association queries should be skipped.
      expect(mockProviderStorage.getProvider).not.toHaveBeenCalled();
      expect(mockUserProviderStorage.findByUserIdEnriched).not.toHaveBeenCalled();
      const decoded = await jwtService.verifyAsync(result.limitedToken);
      expect(decoded.purpose).toBe('first-login-password-change');
      expect(decoded.email).toBe('fresh@test.com');
    });
  });

  describe('updateLastSelectedProvider', () => {
    it('rejects when caller is not associated with the provider', async () => {
      mockUsersService.findOne.mockResolvedValue({ userId: 'u-1', email: 'a@test.com' });
      mockUserProviderStorage.findByUserId.mockResolvedValue([
        { userId: 'u-1', providerId: 'prov-ION', providerRole: 'PROVIDER_ADMIN' },
      ]);
      const result: any = await authService.updateLastSelectedProvider('a@test.com', 'prov-OTHER');
      expect(result.error).toBe('Not authorised for that provider');
      expect(mockUserStorage.updateLastSelectedProviderId).not.toHaveBeenCalled();
    });

    it('persists when caller has the association', async () => {
      mockUsersService.findOne.mockResolvedValue({ userId: 'u-1', email: 'a@test.com' });
      mockUserProviderStorage.findByUserId.mockResolvedValue([
        { userId: 'u-1', providerId: 'prov-ION', providerRole: 'PROVIDER_ADMIN' },
        { userId: 'u-1', providerId: 'prov-BOBOCA', providerRole: 'PROVIDER_ADMIN' },
      ]);
      const result: any = await authService.updateLastSelectedProvider('a@test.com', 'prov-BOBOCA');
      expect(result.success).toBe(true);
      expect(mockUserStorage.updateLastSelectedProviderId).toHaveBeenCalledWith('a@test.com', 'prov-BOBOCA');
    });

    it('accepts null (clear selection) without validation', async () => {
      const result: any = await authService.updateLastSelectedProvider('a@test.com', null);
      expect(result.success).toBe(true);
      expect(mockUserStorage.updateLastSelectedProviderId).toHaveBeenCalledWith('a@test.com', null);
    });

    it('rejects missing email (defensive)', async () => {
      const result: any = await authService.updateLastSelectedProvider('', 'prov-ION');
      expect(result.error).toBe('Authentication required');
    });
  });

  describe('adminCreateUser', () => {
    const superAdminCtx = {
      userContext: {
        userId: 'admin-uuid',
        email: 'admin@test.com',
        isSuperAdmin: true,
        globalRoles: ['superadmin'],
        providerRoles: {},
        providerIds: [],
      },
    };

    it('returns error when email is empty', async () => {
      const result: any = await authService.adminCreateUser({ email: '' }, superAdminCtx);
      expect(result.error).toBe('Email is required');
    });

    it('returns error when an invalid role is requested', async () => {
      const result: any = await authService.adminCreateUser(
        { email: 'new@test.com', roles: ['not-a-real-role'] },
        superAdminCtx,
      );
      expect(result.error).toContain('Invalid role');
    });

    it('throws BadRequest when non-super-admin omits providerId', async () => {
      await expect(
        authService.adminCreateUser(
          { email: 'new@test.com' },
          {
            userContext: {
              userId: 'u-1',
              email: 'admin@test.com',
              isSuperAdmin: false,
              globalRoles: ['client'],
              providerRoles: { 'p-1': 'PROVIDER_ADMIN' },
              providerIds: ['p-1'],
            },
          },
        ),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('throws Forbidden when non-super-admin scope check fails', async () => {
      await expect(
        authService.adminCreateUser(
          { email: 'new@test.com', providerId: 'p-other' },
          {
            userContext: {
              userId: 'u-1',
              email: 'admin@test.com',
              isSuperAdmin: false,
              globalRoles: ['client'],
              providerRoles: { 'p-1': 'PROVIDER_ADMIN' },
              providerIds: ['p-1'],
            },
          },
        ),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('throws Conflict when the email already exists', async () => {
      mockUsersService.findOne.mockResolvedValue({ email: 'existing@test.com', userId: 'u-existing' });
      await expect(
        authService.adminCreateUser(
          { email: 'existing@test.com', providerId: 'p-1' },
          superAdminCtx,
        ),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('auto-generates a 12-char password when none supplied', async () => {
      mockUsersService.findOne
        .mockResolvedValueOnce(null) // collision check
        .mockResolvedValueOnce({ userId: 'u-new', email: 'new@test.com' }); // post-create lookup
      mockUsersService.create.mockResolvedValue({ email: 'new@test.com' });

      const result: any = await authService.adminCreateUser(
        { email: 'new@test.com', providerId: 'p-1' },
        superAdminCtx,
      );

      expect(result.success).toBe(true);
      expect(typeof result.password).toBe('string');
      expect(result.password.length).toBe(12);
      // create() was called with the same password and mustChangePassword=true
      const createCall = (mockUsersService.create as jest.Mock).mock.calls[0][0];
      expect(createCall.password).toBe(result.password);
      expect(createCall.mustChangePassword).toBe(true);
    });

    it('uses the supplied password when one is provided', async () => {
      mockUsersService.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ userId: 'u-new', email: 'new@test.com' });
      mockUsersService.create.mockResolvedValue({ email: 'new@test.com' });

      const result: any = await authService.adminCreateUser(
        { email: 'new@test.com', providerId: 'p-1', password: 'admin-chose-this' },
        superAdminCtx,
      );

      expect(result.password).toBe('admin-chose-this');
      const createCall = (mockUsersService.create as jest.Mock).mock.calls[0][0];
      expect(createCall.password).toBe('admin-chose-this');
    });

    it('upserts user_providers row when providerId is supplied', async () => {
      mockUsersService.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ userId: 'u-new', email: 'new@test.com' });
      mockUsersService.create.mockResolvedValue({ email: 'new@test.com' });

      await authService.adminCreateUser(
        { email: 'new@test.com', providerId: 'p-1', providerRole: 'PROVIDER_ADMIN' },
        superAdminCtx,
      );

      expect(mockUserProviderStorage.upsert).toHaveBeenCalledWith({
        userId: 'u-new',
        providerId: 'p-1',
        providerRole: 'PROVIDER_ADMIN',
      });
    });

    it('defaults providerRole to DIRECTOR when an invalid value is given', async () => {
      mockUsersService.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ userId: 'u-new', email: 'new@test.com' });
      mockUsersService.create.mockResolvedValue({ email: 'new@test.com' });

      const result: any = await authService.adminCreateUser(
        { email: 'new@test.com', providerId: 'p-1', providerRole: 'NOT_A_ROLE' as any },
        superAdminCtx,
      );

      expect(result.providerRole).toBe('DIRECTOR');
    });

    it('skips user_providers upsert when no providerId is given (super-admin only)', async () => {
      mockUsersService.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ userId: 'u-new', email: 'unassociated@test.com' });
      mockUsersService.create.mockResolvedValue({ email: 'unassociated@test.com' });

      await authService.adminCreateUser({ email: 'unassociated@test.com' }, superAdminCtx);

      expect(mockUserProviderStorage.upsert).not.toHaveBeenCalled();
    });

    it('emails the new user when a valid contactEmail is provided (B4)', async () => {
      mockUsersService.findOne
        .mockResolvedValueOnce(null) // collision check
        .mockResolvedValueOnce({ userId: 'u-new', email: 'new@test.com' }); // post-create lookup
      mockUsersService.create.mockResolvedValue({ email: 'new@test.com' });

      const result: any = await authService.adminCreateUser(
        {
          email: 'new@test.com',
          contactEmail: 'real@example.com',
          firstName: 'Alice',
          providerId: 'p-1',
        },
        superAdminCtx,
      );

      expect(result.success).toBe(true);
      expect(result.mode).toBe('email-sent');
      expect(result.contactEmail).toBe('real@example.com');
      expect(result.password).toBeUndefined(); // password is NOT returned on email path
      expect(mockUserStorage.setContactEmail).toHaveBeenCalledWith('u-new', 'real@example.com');
      expect(mockEmailService.sendTemplated).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'real@example.com',
          template: 'admin-created-account',
          tag: 'admin-onboard',
          data: expect.objectContaining({ firstName: 'Alice' }),
        }),
      );
    });

    it('falls back to clipboard handoff when contactEmail is not RFC-shaped', async () => {
      mockUsersService.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ userId: 'u-new', email: 'new@test.com' });
      mockUsersService.create.mockResolvedValue({ email: 'new@test.com' });

      const result: any = await authService.adminCreateUser(
        { email: 'new@test.com', contactEmail: 'not-an-email', providerId: 'p-1' },
        superAdminCtx,
      );

      expect(result.success).toBe(true);
      expect(result.mode).toBe('password-returned');
      expect(typeof result.password).toBe('string');
      expect(mockEmailService.sendTemplated).not.toHaveBeenCalled();
      expect(mockUserStorage.setContactEmail).not.toHaveBeenCalled();
    });

    it('falls back to clipboard handoff when the email send fails', async () => {
      mockUsersService.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ userId: 'u-new', email: 'new@test.com' });
      mockUsersService.create.mockResolvedValue({ email: 'new@test.com' });
      mockEmailService.sendTemplated.mockRejectedValueOnce(new Error('SMTP down'));
      const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);

      const result: any = await authService.adminCreateUser(
        { email: 'new@test.com', contactEmail: 'real@example.com', providerId: 'p-1' },
        superAdminCtx,
      );

      expect(result.success).toBe(true);
      expect(result.mode).toBe('password-returned');
      expect(typeof result.password).toBe('string');
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('completeFirstLogin', () => {
    it('returns error when limitedToken is missing', async () => {
      const result: any = await authService.completeFirstLogin('', 'newPass');
      expect(result.error).toContain('required');
    });

    it('returns error when newPassword is missing', async () => {
      const result: any = await authService.completeFirstLogin('token', '');
      expect(result.error).toContain('required');
    });

    it('throws UnauthorizedException when the token is malformed', async () => {
      await expect(authService.completeFirstLogin('not-a-jwt', 'newPass')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when the token purpose is not first-login', async () => {
      const wrongPurposeToken = await jwtService.signAsync(
        { email: 'fresh@test.com', purpose: 'something-else' },
        { expiresIn: '5m' },
      );
      await expect(
        authService.completeFirstLogin(wrongPurposeToken, 'newPass'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('clears the flag, sets the password, and returns a full session token', async () => {
      const limitedToken = await jwtService.signAsync(
        { email: 'fresh@test.com', purpose: 'first-login-password-change' },
        { expiresIn: '5m' },
      );
      // Two findOne calls: one inside completeFirstLogin, one inside signIn
      // that completeFirstLogin invokes after clearing the flag.
      mockUsersService.findOne.mockResolvedValue({
        email: 'fresh@test.com',
        password: await bcrypt.hash('newPass', 10),
        roles: ['client'],
        mustChangePassword: false, // flag has been cleared by completeFirstLogin
      });

      const result: any = await authService.completeFirstLogin(limitedToken, 'newPass');

      expect(mockUserStorage.completeFirstLogin).toHaveBeenCalledWith(
        'fresh@test.com',
        expect.any(String), // hashed password
      );
      expect(result.token).toBeDefined();
      expect(typeof result.token).toBe('string');
    });
  });

  describe('forgotPassword', () => {
    // The contract is enumeration-defensive: always return { ok: true }
    // regardless of input. The signal of whether a real account exists
    // never leaks via response shape, status code, or timing-distinct
    // failure paths.

    it('returns { ok: true } for an empty address and sends nothing', async () => {
      const result: any = await authService.forgotPassword('');
      expect(result).toEqual({ ok: true });
      expect(mockEmailService.sendTemplated).not.toHaveBeenCalled();
    });

    it('returns { ok: true } when no user has this contact_email', async () => {
      mockUserStorage.findByContactEmail.mockResolvedValue(null);
      const result: any = await authService.forgotPassword('unknown@test.com');
      expect(result).toEqual({ ok: true });
      expect(mockEmailService.sendTemplated).not.toHaveBeenCalled();
    });

    it('returns { ok: true } when the user exists but has not verified their contact_email', async () => {
      mockUserStorage.findByContactEmail.mockResolvedValue({
        userId: 'u-1',
        contactEmail: 'alice@example.com',
        emailVerifiedAt: null,
      });
      const result: any = await authService.forgotPassword('alice@example.com');
      expect(result).toEqual({ ok: true });
      expect(mockEmailService.sendTemplated).not.toHaveBeenCalled();
    });

    it('sends a password-reset email when the user has a verified contact_email', async () => {
      mockUserStorage.findByContactEmail.mockResolvedValue({
        userId: 'u-1',
        contactEmail: 'alice@example.com',
        emailVerifiedAt: '2026-05-22T00:00:00Z',
        firstName: 'Alice',
      });
      const result: any = await authService.forgotPassword('alice@example.com');
      expect(result).toEqual({ ok: true });
      expect(mockEmailService.sendTemplated).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'alice@example.com',
          template: 'password-reset-request',
          tag: 'password-reset',
          data: expect.objectContaining({ firstName: 'Alice' }),
        }),
      );
      const sendCall = (mockEmailService.sendTemplated as jest.Mock).mock.calls[0][0];
      expect(sendCall.data.resetUrl).toMatch(/^https:\/\/nest\.test\.example\/admin\/#\/reset-password\//);
    });

    it('still returns { ok: true } when the email send fails (no enumeration leak)', async () => {
      mockUserStorage.findByContactEmail.mockResolvedValue({
        userId: 'u-1',
        contactEmail: 'alice@example.com',
        emailVerifiedAt: '2026-05-22T00:00:00Z',
      });
      mockEmailService.sendTemplated.mockRejectedValueOnce(new Error('SMTP down'));
      const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
      const result: any = await authService.forgotPassword('alice@example.com');
      expect(result).toEqual({ ok: true });
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('resetPassword', () => {
    it('returns error when token is missing', async () => {
      const result: any = await authService.resetPassword('', 'newPass');
      expect(result.error).toContain('required');
    });

    it('returns error when newPassword is missing', async () => {
      const result: any = await authService.resetPassword('token', '');
      expect(result.error).toContain('required');
    });

    it('throws UnauthorizedException when the token is malformed', async () => {
      await expect(authService.resetPassword('not-a-jwt', 'newPass')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException for a token without the password-reset purpose', async () => {
      const wrong = await jwtService.signAsync(
        { userId: 'u-1', purpose: 'something-else' },
        { expiresIn: '5m' },
      );
      await expect(authService.resetPassword(wrong, 'newPass')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when the user no longer exists', async () => {
      const token = await jwtService.signAsync(
        { userId: 'u-1', contactEmail: 'alice@example.com', purpose: 'password-reset' },
        { expiresIn: '1h' },
      );
      mockUserStorage.findByUserId.mockResolvedValue(null);
      await expect(authService.resetPassword(token, 'newPass')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws ForbiddenException when the user changed their contact_email after the token was issued', async () => {
      const token = await jwtService.signAsync(
        { userId: 'u-1', contactEmail: 'alice@example.com', purpose: 'password-reset' },
        { expiresIn: '1h' },
      );
      mockUserStorage.findByUserId.mockResolvedValue({
        userId: 'u-1',
        contactEmail: 'bob@example.com', // changed since the token was issued
        emailVerifiedAt: null,
      });
      await expect(authService.resetPassword(token, 'newPass')).rejects.toThrow(/changed/);
      expect(mockUserStorage.setPasswordByUserId).not.toHaveBeenCalled();
    });

    it('writes the new password, returns success, and sends a confirmation email', async () => {
      const token = await jwtService.signAsync(
        { userId: 'u-1', contactEmail: 'alice@example.com', purpose: 'password-reset' },
        { expiresIn: '1h' },
      );
      mockUserStorage.findByUserId.mockResolvedValue({
        userId: 'u-1',
        contactEmail: 'alice@example.com',
        emailVerifiedAt: '2026-05-22T00:00:00Z',
        firstName: 'Alice',
      });

      const result: any = await authService.resetPassword(token, 'brand-new-password');

      expect(result.success).toBe(true);
      expect(mockUserStorage.setPasswordByUserId).toHaveBeenCalledWith(
        'u-1',
        expect.any(String), // the bcrypt hash, not the cleartext
      );
      // Confirmation email is fire-and-forget — flush microtasks before asserting.
      await Promise.resolve();
      await Promise.resolve();
      expect(mockEmailService.sendTemplated).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'alice@example.com',
          template: 'password-reset-confirmation',
          tag: 'password-reset-confirmation',
        }),
      );
    });

    it('marks email_verified_at when previously unverified (B4 admin-onboard piggyback)', async () => {
      const token = await jwtService.signAsync(
        { userId: 'u-1', contactEmail: 'alice@example.com', purpose: 'password-reset' },
        { expiresIn: '7d' },
      );
      // Admin-created user: contact_email set but never verified
      mockUserStorage.findByUserId.mockResolvedValue({
        userId: 'u-1',
        contactEmail: 'alice@example.com',
        emailVerifiedAt: null,
        firstName: 'Alice',
      });

      await authService.resetPassword(token, 'newPass');

      expect(mockUserStorage.markEmailVerified).toHaveBeenCalledWith('u-1');
    });

    it('does NOT re-mark email_verified_at when already verified', async () => {
      const token = await jwtService.signAsync(
        { userId: 'u-1', contactEmail: 'alice@example.com', purpose: 'password-reset' },
        { expiresIn: '1h' },
      );
      mockUserStorage.findByUserId.mockResolvedValue({
        userId: 'u-1',
        contactEmail: 'alice@example.com',
        emailVerifiedAt: '2026-05-22T00:00:00Z',
      });

      await authService.resetPassword(token, 'newPass');

      expect(mockUserStorage.markEmailVerified).not.toHaveBeenCalled();
    });
  });

  describe('decode', () => {
    it('decodes a valid JWT', async () => {
      const token = jwtService.sign({ email: 'test@test.com' }, { secret: 'test-secret' });
      const result = await authService.decode(token);
      expect(result.email).toBe('test@test.com');
    });

    it('throws UnauthorizedException for invalid token', async () => {
      await expect(authService.decode('invalid.token.here')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('removeUser / getUsers', () => {
    it('delegates removeUser to usersService', async () => {
      mockUsersService.remove.mockResolvedValue({ success: true });
      const result = await authService.removeUser({ email: 'user@test.com' });
      expect(mockUsersService.remove).toHaveBeenCalledWith('user@test.com');
      expect(result.success).toBe(true);
    });

    it('delegates getUsers to usersService', async () => {
      const users = [{ email: 'a@test.com' }, { email: 'b@test.com' }];
      mockUsersService.findAll.mockResolvedValue(users);
      const result = await authService.getUsers();
      expect(result).toBe(users);
    });
  });

  describe('adminResetPassword', () => {
    const superAdminCtx = {
      userContext: {
        userId: 'admin-uuid',
        email: 'admin@test.com',
        isSuperAdmin: true,
        globalRoles: ['superadmin'],
        providerRoles: {},
        providerIds: [],
      },
    };

    it('returns error when email is missing', async () => {
      const result = await authService.adminResetPassword('', undefined, superAdminCtx);
      expect(result.error).toBe('Email is required');
    });

    it('returns error when target user is missing', async () => {
      mockUsersService.findOne.mockResolvedValue(null);
      const result = await authService.adminResetPassword('missing@test.com', undefined, superAdminCtx);
      expect(result.error).toBe('User not found');
    });

    it('lets a SUPER_ADMIN reset any user without scope check', async () => {
      mockUsersService.findOne.mockResolvedValue({
        email: 'target@test.com',
        userId: 'target-uuid',
        password: 'old-hash',
      });
      const result: any = await authService.adminResetPassword('target@test.com', 'newpw', superAdminCtx);
      expect(result.success).toBe(true);
      expect(mockUserStorage.update).toHaveBeenCalled();
      // SUPER_ADMIN doesn't need to inspect provider associations.
      expect(mockUserProviderStorage.findByUserId).not.toHaveBeenCalled();
    });

    it('allows a PROVIDER_ADMIN at one of the target user\u2019s providers', async () => {
      mockUsersService.findOne.mockResolvedValue({
        email: 'target@test.com',
        userId: 'target-uuid',
        password: 'old-hash',
      });
      mockUserProviderStorage.findByUserId.mockResolvedValue([
        { userId: 'target-uuid', providerId: 'p-1', providerRole: 'DIRECTOR' },
      ]);

      const result: any = await authService.adminResetPassword('target@test.com', 'newpw', {
        userContext: {
          userId: 'editor-uuid',
          email: 'editor@test.com',
          isSuperAdmin: false,
          globalRoles: ['client'],
          providerRoles: { 'p-1': 'PROVIDER_ADMIN' },
          providerIds: ['p-1'],
        },
      });
      expect(result.success).toBe(true);
    });

    it('rejects an editor with no scope at any of the target\u2019s providers', async () => {
      mockUsersService.findOne.mockResolvedValue({
        email: 'target@test.com',
        userId: 'target-uuid',
        password: 'old-hash',
      });
      mockUserProviderStorage.findByUserId.mockResolvedValue([
        { userId: 'target-uuid', providerId: 'p-1', providerRole: 'DIRECTOR' },
      ]);

      await expect(
        authService.adminResetPassword('target@test.com', 'newpw', {
          userContext: {
            userId: 'editor-uuid',
            email: 'editor@test.com',
            isSuperAdmin: false,
            globalRoles: ['client'],
            providerRoles: { 'p-other': 'PROVIDER_ADMIN' },
            providerIds: ['p-other'],
          },
        }),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('rejects a non-super-admin editor when target has no provider associations', async () => {
      mockUsersService.findOne.mockResolvedValue({
        email: 'orphan@test.com',
        userId: 'orphan-uuid',
        password: 'old-hash',
      });
      mockUserProviderStorage.findByUserId.mockResolvedValue([]);

      await expect(
        authService.adminResetPassword('orphan@test.com', 'newpw', {
          userContext: {
            userId: 'editor-uuid',
            email: 'editor@test.com',
            isSuperAdmin: false,
            globalRoles: ['client'],
            providerRoles: { 'p-1': 'PROVIDER_ADMIN' },
            providerIds: ['p-1'],
          },
        }),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('changePassword', () => {
    it('returns error when any field is missing', async () => {
      const result = await authService.changePassword('user@test.com', '', 'new');
      expect(result.error).toMatch(/required/i);
    });

    it('throws 401 when user is not found', async () => {
      mockUsersService.findOne.mockResolvedValue(null);
      await expect(
        authService.changePassword('missing@test.com', 'old', 'new'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws 401 when current password is wrong', async () => {
      const hashed = await bcrypt.hash('correct', 10);
      mockUsersService.findOne.mockResolvedValue({ email: 'user@test.com', password: hashed });

      await expect(
        authService.changePassword('user@test.com', 'wrong', 'new'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('writes the new password when current password matches', async () => {
      const hashed = await bcrypt.hash('correct', 10);
      mockUsersService.findOne.mockResolvedValue({
        email: 'user@test.com',
        password: hashed,
      });

      const result: any = await authService.changePassword('user@test.com', 'correct', 'newpw');
      expect(result.success).toBe(true);
      expect(mockUserStorage.update).toHaveBeenCalledWith(
        'user@test.com',
        expect.objectContaining({ password: expect.any(String) }),
      );
      const updateCall = (mockUserStorage.update as jest.Mock).mock.calls[0];
      expect(updateCall[1].password).not.toBe(hashed);
    });
  });
});
