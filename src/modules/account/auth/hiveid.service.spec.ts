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
  let mockTournamentStorageService: any;

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
    mockIdentityService = {
      resendVerification: jest.fn().mockResolvedValue({ success: true, status: 'pending_verification' }),
    };
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

    mockTournamentStorageService = {
      listTournamentIds: jest.fn().mockResolvedValue([]),
      fetchTournamentRecords: jest.fn().mockResolvedValue({ tournamentRecords: {} }),
      findTournamentRecord: jest.fn().mockResolvedValue({ tournamentRecord: null }),
    };

    service = new HiveIDService(
      authService,
      mockUsersService,
      mockEmailService,
      mockIdentityService,
      mockConfigService,
      mockPersonsClient,
      mockTournamentStorageService,
      mockAuditService,
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

  describe('getMyParticipations', () => {
    it('returns an empty list when the user has no person link yet', async () => {
      mockUserStorage.getPersonLink.mockResolvedValue(null);
      const result = await service.getMyParticipations('u-1');
      expect(result).toEqual({ personId: null, participations: [] });
      expect(mockTournamentStorageService.listTournamentIds).not.toHaveBeenCalled();
    });

    it('scans tournaments and returns matched Participants for the linked personId', async () => {
      mockUserStorage.getPersonLink.mockResolvedValue({
        userId: 'u-1',
        personId: 'p-canon',
        personRevision: 1,
        cached: {
          standardFamilyName: 'Doe',
          standardGivenName: 'Jane',
          birthDate: null,
          sex: null,
          nationalityCode: null,
        },
        consentPreferences: {},
      });
      mockTournamentStorageService.listTournamentIds.mockResolvedValue(['t-1', 't-2']);
      mockTournamentStorageService.fetchTournamentRecords.mockResolvedValue({
        tournamentRecords: {
          't-1': {
            tournamentId: 't-1',
            tournamentName: 'Spring Open',
            startDate: '2026-04-01',
            endDate: '2026-04-07',
            participants: [
              {
                participantId: 'pa-1',
                participantName: 'Jane Doe',
                participantType: 'INDIVIDUAL',
                person: {
                  personOtherIds: [{ organisationId: 'CANONICAL_PERSON', personId: 'p-canon' }],
                },
              },
              {
                participantId: 'pa-2',
                participantName: 'Other Player',
                participantType: 'INDIVIDUAL',
                person: { personOtherIds: [] },
              },
            ],
            events: [{ entries: [{ participantId: 'pa-1' }] }],
          },
          't-2': {
            tournamentId: 't-2',
            tournamentName: 'Winter Cup',
            startDate: '2026-01-15',
            endDate: '2026-01-20',
            participants: [
              {
                participantId: 'pa-9',
                participantName: 'Jane Doe',
                person: {
                  personOtherIds: [
                    { organisationId: 'USTA', personId: '12345' },
                    { organisationId: 'CANONICAL_PERSON', personId: 'p-canon' },
                  ],
                },
              },
            ],
            events: [{ entries: [{ participantId: 'pa-9' }] }, { entries: [{ participantId: 'pa-9' }] }],
          },
        },
      });

      const result = await service.getMyParticipations('u-1');
      expect(result.personId).toBe('p-canon');
      expect(result.participations).toHaveLength(2);
      // Sorted descending by startDate.
      expect(result.participations[0].tournamentId).toBe('t-1');
      expect(result.participations[0].eventCount).toBe(1);
      expect(result.participations[1].tournamentId).toBe('t-2');
      expect(result.participations[1].eventCount).toBe(2);
    });
  });

  describe('getClaimableForTournament', () => {
    it('returns candidates with overlapping names', async () => {
      mockUserStorage.getPersonLink.mockResolvedValue({
        userId: 'u-1',
        personId: 'p-canon',
        personRevision: 1,
        cached: {
          standardFamilyName: 'Doe',
          standardGivenName: 'Jane',
          birthDate: '1990-04-12',
          sex: 'F',
          nationalityCode: 'USA',
        },
        consentPreferences: {},
      });
      mockTournamentStorageService.findTournamentRecord.mockResolvedValue({
        tournamentRecord: {
          tournamentId: 't-1',
          participants: [
            {
              participantId: 'pa-1',
              participantName: 'Jane Doe',
              participantType: 'INDIVIDUAL',
              person: {
                standardGivenName: 'Jane',
                standardFamilyName: 'Doe',
                sex: 'F',
                nationalityCode: 'USA',
                personOtherIds: [],
              },
            },
            {
              participantId: 'pa-2',
              participantName: 'Bob Smith',
              participantType: 'INDIVIDUAL',
              person: {
                standardGivenName: 'Bob',
                standardFamilyName: 'Smith',
                personOtherIds: [],
              },
            },
            // Already linked → excluded.
            {
              participantId: 'pa-3',
              participantName: 'Jane Doe',
              participantType: 'INDIVIDUAL',
              person: {
                standardGivenName: 'Jane',
                standardFamilyName: 'Doe',
                personOtherIds: [{ organisationId: 'CANONICAL_PERSON', personId: 'p-canon' }],
              },
            },
          ],
        },
      });

      const result = await service.getClaimableForTournament('u-1', 't-1');
      expect(result.tournamentId).toBe('t-1');
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].participantId).toBe('pa-1');
      expect(result.candidates[0].alreadyLinkedTo).toBeNull();
    });

    it('returns empty when user has no cached canonical name', async () => {
      mockUserStorage.getPersonLink.mockResolvedValue({
        userId: 'u-1',
        personId: null,
        personRevision: null,
        cached: { standardFamilyName: null, standardGivenName: null, birthDate: null, sex: null, nationalityCode: null },
        consentPreferences: {},
      });
      const result = await service.getClaimableForTournament('u-1', 't-1');
      expect(result).toEqual({ tournamentId: 't-1', candidates: [] });
      expect(mockTournamentStorageService.findTournamentRecord).not.toHaveBeenCalled();
    });

    it('rejects an empty tournamentId', async () => {
      await expect(service.getClaimableForTournament('u-1', '')).rejects.toThrow(/tournamentId/);
    });
  });

  describe('claimParticipant', () => {
    function setupClaimable(): void {
      mockUserStorage.getPersonLink.mockResolvedValue({
        userId: 'u-1',
        personId: 'p-canon',
        personRevision: 1,
        cached: {
          standardFamilyName: 'Doe',
          standardGivenName: 'Jane',
          birthDate: null,
          sex: null,
          nationalityCode: null,
        },
        consentPreferences: {},
      });
      mockTournamentStorageService.findTournamentRecord.mockResolvedValue({
        tournamentRecord: {
          tournamentId: 't-1',
          participants: [
            {
              participantId: 'pa-1',
              participantName: 'Jane Doe',
              participantType: 'INDIVIDUAL',
              person: {
                standardGivenName: 'Jane',
                standardFamilyName: 'Doe',
                personOtherIds: [],
              },
            },
          ],
        },
      });
    }

    it('rejects when the user has no canonical link', async () => {
      mockUserStorage.getPersonLink.mockResolvedValue({
        userId: 'u-1',
        personId: null,
        personRevision: null,
        cached: { standardFamilyName: null, standardGivenName: null, birthDate: null, sex: null, nationalityCode: null },
        consentPreferences: {},
      });
      await expect(
        service.claimParticipant({ userId: 'u-1', tournamentId: 't-1', participantId: 'pa-1' }),
      ).rejects.toThrow(/canonical link/);
    });

    it('rejects when the tournament does not exist', async () => {
      mockUserStorage.getPersonLink.mockResolvedValue({
        userId: 'u-1',
        personId: 'p-canon',
        personRevision: 1,
        cached: {
          standardFamilyName: 'Doe',
          standardGivenName: 'Jane',
          birthDate: null,
          sex: null,
          nationalityCode: null,
        },
        consentPreferences: {},
      });
      mockTournamentStorageService.findTournamentRecord.mockResolvedValue({ tournamentRecord: null });
      await expect(
        service.claimParticipant({ userId: 'u-1', tournamentId: 't-1', participantId: 'pa-1' }),
      ).rejects.toThrow(/Tournament not found/);
    });

    it('rejects when the canonical name does not overlap', async () => {
      mockUserStorage.getPersonLink.mockResolvedValue({
        userId: 'u-1',
        personId: 'p-canon',
        personRevision: 1,
        cached: {
          standardFamilyName: 'Doe',
          standardGivenName: 'Jane',
          birthDate: null,
          sex: null,
          nationalityCode: null,
        },
        consentPreferences: {},
      });
      mockTournamentStorageService.findTournamentRecord.mockResolvedValue({
        tournamentRecord: {
          tournamentId: 't-1',
          participants: [
            {
              participantId: 'pa-1',
              participantName: 'Bob Smith',
              participantType: 'INDIVIDUAL',
              person: { standardGivenName: 'Bob', standardFamilyName: 'Smith', personOtherIds: [] },
            },
          ],
        },
      });
      await expect(
        service.claimParticipant({ userId: 'u-1', tournamentId: 't-1', participantId: 'pa-1' }),
      ).rejects.toThrow(/canonical name/);
    });

    it('requires tournamentId + participantId', async () => {
      setupClaimable();
      await expect(
        service.claimParticipant({ userId: 'u-1', tournamentId: '', participantId: 'pa-1' }),
      ).rejects.toThrow(/required/);
      await expect(
        service.claimParticipant({ userId: 'u-1', tournamentId: 't-1', participantId: '' }),
      ).rejects.toThrow(/required/);
    });
  });
});
