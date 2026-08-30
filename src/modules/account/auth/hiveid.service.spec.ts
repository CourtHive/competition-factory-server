import { ConflictException, HttpException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { HiveIDService } from './hiveid.service';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';

import { HIVEID_MAGIC_LINK_PREFIX } from './hiveid.constants';

describe('HiveIDService', () => {
  let service: HiveIDService;
  let authService: AuthService;
  let jwtService: JwtService;
  let mockUsersService: any;
  let mockEmailService: any;
  let mockConfigService: any;
  let mockProviderStorage: any;
  let mockUserStorage: any;
  let mockUserProviderStorage: any;
  let mockUserProvisionerStorage: any;
  let mockProvisionerProviderStorage: any;
  let mockRefreshTokenService: any;
  let mockAuthCodeStorage: any;
  let mockIdentityService: any;
  let mockAuditService: any;
  let mockPersonsClient: any;

  beforeEach(() => {
    process.env.APP_BASE_URL = 'https://nest.test.example';
    jwtService = new JwtService({ secret: 'test-secret' });

    mockUsersService = {
      findOne: vi.fn(),
      create: vi.fn().mockResolvedValue({ email: 'new@test.com' }),
      findAll: vi.fn(),
      remove: vi.fn(),
      getDevUserById: vi.fn().mockReturnValue(null),
    };

    mockEmailService = { sendTemplated: vi.fn().mockResolvedValue({ id: 'msg-1' }) };
    mockConfigService = {
      get: vi.fn().mockReturnValue({ baseUrl: 'https://nest.test.example' }),
    };
    mockProviderStorage = {
      getProvider: vi.fn().mockResolvedValue(null),
      updateLastAccess: vi.fn().mockResolvedValue(undefined),
    };
    mockUserStorage = {
      setContactEmail: vi.fn().mockResolvedValue({ success: true }),
      setPersonLink: vi.fn().mockResolvedValue({ success: true }),
      getPersonLink: vi.fn().mockResolvedValue(null),
      markEmailVerified: vi.fn().mockResolvedValue({ success: true }),
      findByUserId: vi.fn().mockResolvedValue(null),
      updateLastAccess: vi.fn().mockResolvedValue(undefined),
    };
    mockUserProviderStorage = {
      findByUserIdEnriched: vi.fn().mockResolvedValue([]),
      findByUserId: vi.fn().mockResolvedValue([]),
    };
    mockUserProvisionerStorage = {
      findProvisionerIdsByUser: vi.fn().mockResolvedValue([]),
    };
    mockProvisionerProviderStorage = {
      findByProvisioner: vi.fn().mockResolvedValue([]),
    };
    mockRefreshTokenService = {
      issue: vi.fn().mockResolvedValue('rtok_test_token'),
      rotate: vi.fn(),
      revoke: vi.fn().mockResolvedValue(undefined),
      revokeAllForUser: vi.fn().mockResolvedValue(undefined),
    };
    mockAuthCodeStorage = {
      setAccessCode: vi.fn().mockResolvedValue({ success: true }),
      consumeAccessCode: vi.fn(),
    };
    mockIdentityService = {
      resendVerification: vi.fn().mockResolvedValue({ success: true, status: 'pending_verification' }),
      setContactEmail: vi.fn().mockResolvedValue({ success: true, status: 'pending_verification', contactEmail: 'new@test.com' }),
    };
    mockAuditService = {};
    mockPersonsClient = {
      resolve: vi.fn(),
      getById: vi.fn(),
    };

    authService = new AuthService(
      mockUsersService,
      jwtService,
      mockEmailService,
      mockConfigService,
      mockProviderStorage,
      mockUserStorage,
      mockUserProvisionerStorage,
      mockUserProviderStorage,
      mockProvisionerProviderStorage,
      mockRefreshTokenService,
      mockAuthCodeStorage,
      mockIdentityService,
      mockAuditService,
    );

    service = new HiveIDService(
      authService,
      mockUsersService,
      mockEmailService,
      mockIdentityService,
      mockConfigService,
      mockPersonsClient,
      mockUserStorage,
      mockAuthCodeStorage,
    );
  });

  afterEach(() => {
    delete process.env.APP_BASE_URL;
  });

  function decodeToken(token: string): any {
    return jwtService.verify(token, { secret: 'test-secret' });
  }

  describe('signup', () => {
    it('creates a new user, sets the person link, and issues a hiveid-audience token', async () => {
      mockUsersService.findOne
        .mockResolvedValueOnce(null) // existence check
        .mockResolvedValueOnce({ userId: 'u-new', email: 'new@test.com' }); // post-create lookup
      mockPersonsClient.resolve.mockResolvedValue({
        status: 'minted',
        personId: 'person-123',
        personRevision: 1,
      });
      mockPersonsClient.getById.mockResolvedValue({
        person: {
          standardFamilyName: 'Doe',
          standardGivenName: 'Jane',
          birthDate: '1990-04-12',
          sex: 'F',
          nationalityCode: 'USA',
          personId: 'person-123',
          tennisId: null,
          mergedInto: null,
          personRevision: 1,
        },
        aliases: [],
      });

      const result: any = await service.signup({
        email: 'new@test.com',
        firstName: 'Jane',
        lastName: 'Doe',
      });

      expect(result.status).toBe('created');
      expect(result.personId).toBe('person-123');
      expect(result.token).toBeDefined();
      expect(result.refreshToken).toBe('rtok_test_token');
      expect(decodeToken(result.token).aud).toBe('hiveid');
      // Brand-new signup is not yet verified — claim must be false.
      expect(decodeToken(result.token).email_verified).toBe(false);
      expect(mockUserStorage.setPersonLink).toHaveBeenCalledWith('u-new', expect.objectContaining({
        personId: 'person-123',
        personRevision: 1,
      }));
      expect(mockUserStorage.setContactEmail).toHaveBeenCalledWith('u-new', 'new@test.com');
      // Fires the email-verification mail with a courthive-public landing.
      expect(mockIdentityService.resendVerification).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-new', email: 'new@test.com' }),
        { landing: 'public' },
      );
    });

    it('still issues a session when the verification email fails to send', async () => {
      mockUsersService.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ userId: 'u-new', email: 'new@test.com' });
      mockPersonsClient.resolve.mockResolvedValue({ status: 'minted', personId: 'p-1', personRevision: 1 });
      mockPersonsClient.getById.mockResolvedValue({ person: { standardGivenName: 'Jane', standardFamilyName: 'Doe' } });
      mockIdentityService.resendVerification.mockRejectedValueOnce(new Error('smtp down'));

      const result: any = await service.signup({ email: 'new@test.com', firstName: 'Jane', lastName: 'Doe' });
      expect(result.status).toBe('created');
      expect(result.token).toBeDefined();
    });

    it('throws 409 ConflictException when the email already exists', async () => {
      mockUsersService.findOne.mockResolvedValueOnce({ userId: 'u-existing', email: 'admin@test.com' });
      await expect(
        service.signup({ email: 'admin@test.com', firstName: 'A', lastName: 'B' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockPersonsClient.resolve).not.toHaveBeenCalled();
    });

    it('returns candidates without creating a row when resolve is ambiguous', async () => {
      mockUsersService.findOne.mockResolvedValueOnce(null);
      mockPersonsClient.resolve.mockResolvedValue({
        status: 'candidate',
        candidates: [{ personId: 'p-1', confidence: 0.6 }],
      });
      const result: any = await service.signup({
        email: 'new@test.com',
        firstName: 'Jane',
        lastName: 'Doe',
      });
      expect(result).toEqual({ status: 'candidate', candidates: [{ personId: 'p-1', confidence: 0.6 }] });
      expect(mockUsersService.create).not.toHaveBeenCalled();
      expect(mockUserStorage.setPersonLink).not.toHaveBeenCalled();
    });

    it('throws 422 HttpException when resolve returns incomplete', async () => {
      mockUsersService.findOne.mockResolvedValueOnce(null);
      mockPersonsClient.resolve.mockResolvedValue({ status: 'incomplete', missingFields: ['birthDate'] });
      await expect(
        service.signup({ email: 'new@test.com', firstName: 'J', lastName: 'D' }),
      ).rejects.toBeInstanceOf(HttpException);
      expect(mockUsersService.create).not.toHaveBeenCalled();
    });

    it('rejects when firstName or lastName is missing', async () => {
      await expect(
        service.signup({ email: 'x@y.z', firstName: '', lastName: 'Doe' }),
      ).rejects.toThrow();
      await expect(
        service.signup({ email: 'x@y.z', firstName: 'Jane', lastName: '' }),
      ).rejects.toThrow();
    });

    it('forwards birthDate + sex and a synthesized provider-scoped otherId so persons can MINT', async () => {
      mockUsersService.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ userId: 'u-new', email: 'new@test.com' });
      mockPersonsClient.resolve.mockResolvedValue({ status: 'minted', personId: 'p-mint', personRevision: 1 });
      mockPersonsClient.getById.mockResolvedValue({ person: { standardGivenName: 'Jane', standardFamilyName: 'Doe' } });

      const result: any = await service.signup({
        email: 'new@test.com',
        firstName: 'Jane',
        lastName: 'Doe',
        birthDate: '1990-04-12',
        sex: 'F',
        provider: 'BOBOCA',
      });

      expect(result.status).toBe('created');
      expect(result.personId).toBe('p-mint');
      const fragment = mockPersonsClient.resolve.mock.calls[0][0];
      expect(fragment.birthDate).toBe('1990-04-12');
      expect(fragment.sex).toBe('F');
      // A single synthesized {provider, externalId} anchors the fresh mint to the tenant.
      expect(fragment.personOtherIds).toHaveLength(1);
      expect(fragment.personOtherIds[0].provider).toBe('BOBOCA');
      expect(typeof fragment.personOtherIds[0].externalId).toBe('string');
      expect(fragment.personOtherIds[0].externalId.length).toBeGreaterThan(0);
    });

    it('combines quoted federationIds with the synthesized provider id', async () => {
      mockUsersService.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ userId: 'u-new', email: 'new@test.com' });
      mockPersonsClient.resolve.mockResolvedValue({ status: 'resolved', personId: 'p-alias', personRevision: 3 });
      mockPersonsClient.getById.mockResolvedValue({ person: { standardGivenName: 'Jane', standardFamilyName: 'Doe' } });

      await service.signup({
        email: 'new@test.com',
        firstName: 'Jane',
        lastName: 'Doe',
        birthDate: '1990-04-12',
        sex: 'F',
        provider: 'BOBOCA',
        federationIds: [{ provider: 'HTS', externalId: 'hts-42' }],
      });

      const fragment = mockPersonsClient.resolve.mock.calls[0][0];
      expect(fragment.personOtherIds).toEqual([
        { provider: 'HTS', externalId: 'hts-42' },
        expect.objectContaining({ provider: 'BOBOCA' }),
      ]);
    });

    it('stays name-only (no synthesized id, no DOB/sex) when no provider context is supplied', async () => {
      mockUsersService.findOne.mockResolvedValueOnce(null);
      mockPersonsClient.resolve.mockResolvedValue({ status: 'incomplete', missingFields: ['birthDate', 'sex'] });
      await expect(
        service.signup({ email: 'new@test.com', firstName: 'J', lastName: 'D' }),
      ).rejects.toBeInstanceOf(HttpException);
      const fragment = mockPersonsClient.resolve.mock.calls[0][0];
      expect(fragment.personOtherIds).toEqual([]);
      expect(fragment.birthDate).toBeUndefined();
      expect(fragment.sex).toBeUndefined();
    });
  });

  describe('verifyExisting', () => {
    it('rejects on wrong password', async () => {
      const hashed = await bcrypt.hash('correct-password', 4);
      mockUsersService.findOne.mockResolvedValue({
        userId: 'u-1',
        email: 'admin@test.com',
        password: hashed,
        firstName: 'A',
        lastName: 'B',
        roles: ['CLIENT'],
      });
      await expect(
        service.verifyExisting({ email: 'admin@test.com', password: 'wrong' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('issues admin+hiveid audience and skips resolve when already linked', async () => {
      const hashed = await bcrypt.hash('pw', 4);
      mockUsersService.findOne.mockResolvedValue({
        userId: 'u-1',
        email: 'admin@test.com',
        password: hashed,
        firstName: 'Jane',
        lastName: 'Doe',
        roles: ['CLIENT'],
      });
      mockUserStorage.getPersonLink.mockResolvedValue({
        userId: 'u-1',
        personId: 'p-existing',
        personRevision: 5,
        cached: {
          standardFamilyName: 'Doe',
          standardGivenName: 'Jane',
          birthDate: '1990-04-12',
          sex: 'F',
          nationalityCode: 'USA',
        },
        consentPreferences: {},
      });
      const result: any = await service.verifyExisting({ email: 'admin@test.com', password: 'pw' });
      expect(result.status).toBe('verified');
      expect(result.personId).toBe('p-existing');
      expect(decodeToken(result.token).aud).toEqual(['admin', 'hiveid']);
      expect(mockPersonsClient.resolve).not.toHaveBeenCalled();
      expect(mockUserStorage.setPersonLink).not.toHaveBeenCalled();
    });

    it('resolves and links when the existing user has no person link yet', async () => {
      const hashed = await bcrypt.hash('pw', 4);
      mockUsersService.findOne.mockResolvedValue({
        userId: 'u-2',
        email: 'admin@test.com',
        password: hashed,
        firstName: 'Jane',
        lastName: 'Doe',
        roles: ['CLIENT'],
      });
      mockUserStorage.getPersonLink.mockResolvedValue(null);
      mockPersonsClient.resolve.mockResolvedValue({
        status: 'resolved',
        personId: 'p-resolved',
        personRevision: 7,
      });
      mockPersonsClient.getById.mockResolvedValue({
        person: {
          standardFamilyName: 'Doe',
          standardGivenName: 'Jane',
          birthDate: '1990-04-12',
          sex: 'F',
          nationalityCode: 'USA',
          personId: 'p-resolved',
          tennisId: null,
          mergedInto: null,
          personRevision: 7,
        },
        aliases: [],
      });
      const result: any = await service.verifyExisting({ email: 'admin@test.com', password: 'pw' });
      expect(result.personId).toBe('p-resolved');
      expect(mockUserStorage.setPersonLink).toHaveBeenCalledWith('u-2', expect.objectContaining({
        personId: 'p-resolved',
        personRevision: 7,
      }));
      expect(decodeToken(result.token).aud).toEqual(['admin', 'hiveid']);
    });

    it('upgrades audience even when resolve fails (best-effort link)', async () => {
      const hashed = await bcrypt.hash('pw', 4);
      mockUsersService.findOne.mockResolvedValue({
        userId: 'u-3',
        email: 'admin@test.com',
        password: hashed,
        firstName: 'Jane',
        lastName: 'Doe',
        roles: ['CLIENT'],
      });
      mockUserStorage.getPersonLink.mockResolvedValue(null);
      mockPersonsClient.resolve.mockRejectedValue(new Error('persons offline'));
      const result: any = await service.verifyExisting({ email: 'admin@test.com', password: 'pw' });
      expect(result.status).toBe('verified');
      expect(result.personId).toBeNull();
      expect(decodeToken(result.token).aud).toEqual(['admin', 'hiveid']);
      expect(mockUserStorage.setPersonLink).not.toHaveBeenCalled();
    });
  });

  describe('requestMagicLink', () => {
    it('returns ok and sends mail when user exists', async () => {
      mockUsersService.findOne.mockResolvedValue({
        userId: 'u-1',
        email: 'jane@test.com',
        firstName: 'Jane',
      });
      const result = await service.requestMagicLink('jane@test.com');
      expect(result).toEqual({ ok: true });
      expect(mockEmailService.sendTemplated).toHaveBeenCalledTimes(1);
      const args = mockEmailService.sendTemplated.mock.calls[0][0];
      expect(args.tag).toBe('hiveid-magic-link');
      expect(args.data.magicLinkUrl).toContain('#/hiveid/magic/');
      const storedCode = mockAuthCodeStorage.setAccessCode.mock.calls[0][0];
      expect(storedCode.startsWith(HIVEID_MAGIC_LINK_PREFIX)).toBe(true);
    });

    it('returns ok without mailing when the email is unknown (enumeration-defensive)', async () => {
      mockUsersService.findOne.mockResolvedValue(null);
      const result = await service.requestMagicLink('ghost@test.com');
      expect(result).toEqual({ ok: true });
      expect(mockEmailService.sendTemplated).not.toHaveBeenCalled();
      expect(mockAuthCodeStorage.setAccessCode).not.toHaveBeenCalled();
    });

    it('swallows storage errors and still returns ok', async () => {
      mockUsersService.findOne.mockResolvedValue({ userId: 'u-1', email: 'x@y.z' });
      mockAuthCodeStorage.setAccessCode.mockRejectedValue(new Error('boom'));
      const result = await service.requestMagicLink('x@y.z');
      expect(result).toEqual({ ok: true });
    });
  });

  describe('consumeMagicLink', () => {
    it('rejects codes without the hiveid prefix', async () => {
      await expect(service.consumeMagicLink('mlk_admin_code')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mockAuthCodeStorage.consumeAccessCode).not.toHaveBeenCalled();
    });

    it('rejects unknown codes', async () => {
      mockAuthCodeStorage.consumeAccessCode.mockResolvedValue(null);
      await expect(
        service.consumeMagicLink(`${HIVEID_MAGIC_LINK_PREFIX}deadbeef`),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('issues a hiveid token, stamps email verification, and returns the person link', async () => {
      mockAuthCodeStorage.consumeAccessCode.mockResolvedValue('jane@test.com');
      mockUsersService.findOne.mockResolvedValue({
        userId: 'u-1',
        email: 'jane@test.com',
        emailVerifiedAt: null,
        firstName: 'Jane',
        lastName: 'Doe',
      });
      mockUserStorage.getPersonLink.mockResolvedValue({
        userId: 'u-1',
        personId: 'p-1',
        personRevision: 4,
        cached: {
          standardFamilyName: 'Doe',
          standardGivenName: 'Jane',
          birthDate: '1990-04-12',
          sex: 'F',
          nationalityCode: 'USA',
        },
        consentPreferences: {},
      });

      const result: any = await service.consumeMagicLink(`${HIVEID_MAGIC_LINK_PREFIX}abcdef`);
      expect(result.status).toBe('authenticated');
      expect(result.personId).toBe('p-1');
      expect(decodeToken(result.token).aud).toBe('hiveid');
      // A consumed magic link proves mailbox control — claim must be true.
      expect(decodeToken(result.token).email_verified).toBe(true);
      expect(mockUserStorage.markEmailVerified).toHaveBeenCalledWith('u-1');
    });
  });

  describe('getMe', () => {
    it('returns the hiveid projection from storage', async () => {
      mockUserStorage.findByUserId.mockResolvedValue({
        userId: 'u-1',
        email: 'jane@test.com',
        emailVerifiedAt: '2026-05-30T00:00:00Z',
      });
      mockUserStorage.getPersonLink.mockResolvedValue({
        userId: 'u-1',
        personId: 'p-1',
        personRevision: 2,
        cached: {
          standardFamilyName: 'Doe',
          standardGivenName: 'Jane',
          birthDate: '1990-04-12',
          sex: 'F',
          nationalityCode: 'USA',
        },
        consentPreferences: { notifications: true },
      });
      const result = await service.getMe('u-1');
      expect(result).toEqual({
        userId: 'u-1',
        email: 'jane@test.com',
        contactEmail: 'jane@test.com',
        emailVerifiedAt: '2026-05-30T00:00:00Z',
        personId: 'p-1',
        personRevision: 2,
        cached: {
          standardFamilyName: 'Doe',
          standardGivenName: 'Jane',
          birthDate: '1990-04-12',
          sex: 'F',
          nationalityCode: 'USA',
        },
        consentPreferences: { notifications: true },
      });
    });

    it('throws when the user does not exist', async () => {
      mockUserStorage.findByUserId.mockResolvedValue(null);
      await expect(service.getMe('ghost')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('falls back to the dev-mode test super-admin when there is no storage row', async () => {
      // The dev test user (TEST_EMAIL) has no `users` row — resolved from the
      // in-memory dev list so /me works in development instead of 401ing.
      mockUserStorage.findByUserId.mockResolvedValue(null);
      mockUserStorage.getPersonLink.mockResolvedValue(null);
      mockUsersService.getDevUserById.mockReturnValue({ userId: 'dev-id', email: 'axel@castle.com' });

      const result: any = await service.getMe('dev-id');
      expect(result.userId).toBe('dev-id');
      expect(result.email).toBe('axel@castle.com');
      expect(result.personId).toBeNull();
    });

    it('surfaces the contact email (falling back to the login email)', async () => {
      mockUserStorage.findByUserId.mockResolvedValue({ userId: 'u-2', email: 'login@test.com', contactEmail: 'contact@test.com' });
      mockUserStorage.getPersonLink.mockResolvedValue(null);
      const withContact: any = await service.getMe('u-2');
      expect(withContact.contactEmail).toBe('contact@test.com');

      mockUserStorage.findByUserId.mockResolvedValue({ userId: 'u-3', email: 'login@test.com' });
      const noContact: any = await service.getMe('u-3');
      expect(noContact.contactEmail).toBe('login@test.com');
    });

    it('throws when no userId is provided', async () => {
      await expect(service.getMe('')).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('setContactEmail', () => {
    it('delegates to IdentityService with the caller identity', async () => {
      const result: any = await service.setContactEmail({
        userId: 'u-1',
        email: 'login@test.com',
        firstName: 'Jane',
        contactEmail: 'new@test.com',
      });
      expect(mockIdentityService.setContactEmail).toHaveBeenCalledWith(
        { userId: 'u-1', email: 'login@test.com', firstName: 'Jane' },
        'new@test.com',
      );
      expect(result.status).toBe('pending_verification');
    });

    it('rejects when there is no userId', async () => {
      await expect(service.setContactEmail({ userId: '', contactEmail: 'x@y.z' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('resendVerification', () => {
    it('delegates to IdentityService with a public landing', async () => {
      const result: any = await service.resendVerification({
        userId: 'u-1',
        email: 'jane@test.com',
        firstName: 'Jane',
      });
      expect(result.status).toBe('pending_verification');
      expect(mockIdentityService.resendVerification).toHaveBeenCalledWith(
        { userId: 'u-1', email: 'jane@test.com', firstName: 'Jane' },
        { landing: 'public' },
      );
    });

    it('throws when the caller is unauthenticated', async () => {
      await expect(service.resendVerification({ userId: '', email: '' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
