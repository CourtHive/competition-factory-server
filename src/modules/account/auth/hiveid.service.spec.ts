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
      findOne: jest.fn(),
      create: jest.fn().mockResolvedValue({ email: 'new@test.com' }),
      findAll: jest.fn(),
      remove: jest.fn(),
    };

    mockEmailService = { sendTemplated: jest.fn().mockResolvedValue({ id: 'msg-1' }) };
    mockConfigService = {
      get: jest.fn().mockReturnValue({ baseUrl: 'https://nest.test.example' }),
    };
    mockProviderStorage = {
      getProvider: jest.fn().mockResolvedValue(null),
      updateLastAccess: jest.fn().mockResolvedValue(undefined),
    };
    mockUserStorage = {
      setContactEmail: jest.fn().mockResolvedValue({ success: true }),
      setPersonLink: jest.fn().mockResolvedValue({ success: true }),
      getPersonLink: jest.fn().mockResolvedValue(null),
      markEmailVerified: jest.fn().mockResolvedValue({ success: true }),
      findByUserId: jest.fn().mockResolvedValue(null),
      updateLastAccess: jest.fn().mockResolvedValue(undefined),
    };
    mockUserProviderStorage = {
      findByUserIdEnriched: jest.fn().mockResolvedValue([]),
      findByUserId: jest.fn().mockResolvedValue([]),
    };
    mockUserProvisionerStorage = {
      findProvisionerIdsByUser: jest.fn().mockResolvedValue([]),
    };
    mockProvisionerProviderStorage = {
      findByProvisioner: jest.fn().mockResolvedValue([]),
    };
    mockRefreshTokenService = {
      issue: jest.fn().mockResolvedValue('rtok_test_token'),
      rotate: jest.fn(),
      revoke: jest.fn().mockResolvedValue(undefined),
      revokeAllForUser: jest.fn().mockResolvedValue(undefined),
    };
    mockAuthCodeStorage = {
      setAccessCode: jest.fn().mockResolvedValue({ success: true }),
      consumeAccessCode: jest.fn(),
    };
    mockIdentityService = {};
    mockAuditService = {};
    mockPersonsClient = {
      resolve: jest.fn(),
      getById: jest.fn(),
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
      expect(mockUserStorage.setPersonLink).toHaveBeenCalledWith('u-new', expect.objectContaining({
        personId: 'person-123',
        personRevision: 1,
      }));
      expect(mockUserStorage.setContactEmail).toHaveBeenCalledWith('u-new', 'new@test.com');
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

    it('throws when no userId is provided', async () => {
      await expect(service.getMe('')).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
