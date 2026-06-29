/**
 * TrackerTokenService — unit tests for /auth/tracker-token mint.
 *
 * Covers the workflow contract from
 * Mentat/planning/IONSPORT_SCORE_SUBMISSION_API.md: provider-ownership
 * gate, TTL bounds (60s floor, 8h ceiling, 1h default), JWT claims
 * (`aud: score` + `tournamentId` + `exp`), and the
 * TRACKER_TOKEN_ISSUED audit row.
 */
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { TrackerTokenService } from './tracker-token.service';

jest.mock('src/common/constants/feature-flags', () => ({
  isTournamentAccessScopingEnabled: () => true,
}));

const PROVIDER_ID = 'p-ionsport';
const TOURNAMENT_ID = 't-2026-xyz';

describe('TrackerTokenService', () => {
  let service: TrackerTokenService;
  let mockJwtService: JwtService;
  let mockTournamentStorage: any;
  let mockAuditService: any;

  const ownedTournament = {
    tournamentId: TOURNAMENT_ID,
    parentOrganisation: { organisationId: PROVIDER_ID },
  };

  function makeContext(overrides: Record<string, any> = {}): any {
    return {
      userId: `provider:${PROVIDER_ID}`,
      email: `key@${PROVIDER_ID}`,
      isSuperAdmin: false,
      providerRoles: { [PROVIDER_ID]: 'PROVIDER_ADMIN' },
      providerIds: [PROVIDER_ID],
      provisionerProviderIds: [],
      globalRoles: ['client', 'generate', 'score'],
      ...overrides,
    };
  }

  beforeEach(() => {
    // IMPORTANT: mirror the real AuthModule's JwtModule.register() shape.
    // The production module registers signOptions: { expiresIn: '<JWT_VALIDITY>' };
    // a pre-fc1dc53 version of this spec constructed JwtService with no
    // signOptions and missed the `Bad options.expiresIn option the payload
    // already has an exp property` clash that hit prod.
    // See Mentat/standards/architectural-standards.md A1 (mock divergence
    // from module register options).
    mockJwtService = new JwtService({
      secret: 'test-secret',
      signOptions: { expiresIn: '1d' },
    });
    mockTournamentStorage = {
      fetchTournamentRecords: jest.fn().mockResolvedValue({
        tournamentRecords: { [TOURNAMENT_ID]: ownedTournament },
      }),
    };
    mockAuditService = {
      recordTrackerTokenIssued: jest.fn().mockResolvedValue(undefined),
    };
    service = new TrackerTokenService(mockJwtService, mockTournamentStorage, mockAuditService);
  });

  // Sentinel: if a future change puts `exp` directly into the JWT
  // payload while leaving signOptions.expiresIn set in the real module,
  // jsonwebtoken throws 'Bad options.expiresIn option the payload already
  // has an exp property'. This test asserts the service does NOT do that.
  it('does not put exp in the payload when signOptions.expiresIn is set on the module', async () => {
    await expect(
      service.mintTrackerToken(
        { tournamentId: TOURNAMENT_ID, ttlSeconds: 1800 },
        { providerId: PROVIDER_ID },
        makeContext(),
      ),
    ).resolves.toMatchObject({ token: expect.any(String) });
  });

  it('mints a token with score audience, tournamentId, and exp', async () => {
    const result = await service.mintTrackerToken(
      { tournamentId: TOURNAMENT_ID, ttlSeconds: 7200 },
      { providerId: PROVIDER_ID },
      makeContext(),
    );

    expect(result.token).toBeDefined();
    const decoded: any = await mockJwtService.verifyAsync(result.token);
    expect(decoded.aud).toBe('score');
    expect(decoded.tournamentId).toBe(TOURNAMENT_ID);
    expect(decoded.sub).toBe(`provider:${PROVIDER_ID}`);
    expect(decoded.exp - decoded.iat).toBe(7200);
    expect(result.expiresAt).toBe(new Date(decoded.exp * 1000).toISOString());
  });

  it('defaults ttlSeconds to 3600 when omitted', async () => {
    const result = await service.mintTrackerToken(
      { tournamentId: TOURNAMENT_ID },
      { providerId: PROVIDER_ID },
      makeContext(),
    );
    const decoded: any = await mockJwtService.verifyAsync(result.token);
    expect(decoded.exp - decoded.iat).toBe(3600);
  });

  it('rejects ttlSeconds below the 60s floor', async () => {
    await expect(
      service.mintTrackerToken(
        { tournamentId: TOURNAMENT_ID, ttlSeconds: 30 },
        { providerId: PROVIDER_ID },
        makeContext(),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects ttlSeconds above the 8h ceiling', async () => {
    await expect(
      service.mintTrackerToken(
        { tournamentId: TOURNAMENT_ID, ttlSeconds: 28801 },
        { providerId: PROVIDER_ID },
        makeContext(),
      ),
    ).rejects.toThrow(/ceiling.*8h/);
  });

  it('rejects when tournamentId is missing', async () => {
    await expect(
      service.mintTrackerToken({ tournamentId: '' }, { providerId: PROVIDER_ID }, makeContext()),
    ).rejects.toThrow(BadRequestException);
  });

  it('returns 404 when the tournament does not exist', async () => {
    mockTournamentStorage.fetchTournamentRecords.mockResolvedValueOnce({ tournamentRecords: {} });
    await expect(
      service.mintTrackerToken(
        { tournamentId: 'nope' },
        { providerId: PROVIDER_ID },
        makeContext(),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('returns 403 when the caller does not own the tournament', async () => {
    const otherProvider = { providerRoles: { 'other-provider': 'PROVIDER_ADMIN' }, providerIds: ['other-provider'] };
    await expect(
      service.mintTrackerToken(
        { tournamentId: TOURNAMENT_ID },
        { providerId: 'other-provider' },
        makeContext(otherProvider),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('admits SUPER_ADMIN across any provider', async () => {
    const result = await service.mintTrackerToken(
      { tournamentId: TOURNAMENT_ID },
      { userId: 'u-admin' },
      makeContext({ isSuperAdmin: true, providerRoles: {} }),
    );
    expect(result.token).toBeDefined();
  });

  it('writes a TRACKER_TOKEN_ISSUED audit row on success', async () => {
    await service.mintTrackerToken(
      { tournamentId: TOURNAMENT_ID, ttlSeconds: 1800 },
      { providerId: PROVIDER_ID, userId: 'u-key' },
      makeContext(),
    );
    expect(mockAuditService.recordTrackerTokenIssued).toHaveBeenCalledWith(
      expect.objectContaining({
        tournamentId: TOURNAMENT_ID,
        providerId: PROVIDER_ID,
        audience: 'score',
        ttlSeconds: 1800,
        userId: 'u-key',
      }),
    );
  });

  // Audit attribution pollution under X-Provider-Id (MED, 2026-05-31
  // punch list). When a provisioner mints with its API key + an
  // X-Provider-Id header, the middleware sets req.provisioner.provisionerId
  // AND synthesizes req.user.providerId from the header. The audit row
  // must attribute the mint to the provisioner — otherwise the action
  // logs against the tenant provider (e.g. BOBOCA) and the audit trail
  // can't be used to bound a provisioner's blast radius.
  it('forwards provisionerId to the audit row so toActor stamps a provisioner actor', async () => {
    const PROVISIONER_ID = 'pv-ionsport';
    await service.mintTrackerToken(
      { tournamentId: TOURNAMENT_ID, ttlSeconds: 1800 },
      { providerId: PROVIDER_ID, provisionerId: PROVISIONER_ID },
      makeContext(),
    );
    expect(mockAuditService.recordTrackerTokenIssued).toHaveBeenCalledWith(
      expect.objectContaining({
        tournamentId: TOURNAMENT_ID,
        providerId: PROVIDER_ID,
        provisionerId: PROVISIONER_ID,
      }),
    );
  });

  it('omits provisionerId from the audit row when no provisioner is on the call', async () => {
    await service.mintTrackerToken(
      { tournamentId: TOURNAMENT_ID },
      { providerId: PROVIDER_ID },
      makeContext(),
    );
    const call = mockAuditService.recordTrackerTokenIssued.mock.calls[0][0];
    expect(call.provisionerId).toBeUndefined();
  });

  it('does not fail the mint when the audit write throws', async () => {
    mockAuditService.recordTrackerTokenIssued.mockRejectedValueOnce(new Error('audit-down'));
    await expect(
      service.mintTrackerToken(
        { tournamentId: TOURNAMENT_ID },
        { providerId: PROVIDER_ID },
        makeContext(),
      ),
    ).resolves.toMatchObject({ token: expect.any(String) });
  });

  it('rejects ttlSeconds that is not a finite number', async () => {
    await expect(
      service.mintTrackerToken(
        { tournamentId: TOURNAMENT_ID, ttlSeconds: NaN as any },
        { providerId: PROVIDER_ID },
        makeContext(),
      ),
    ).rejects.toThrow(/finite/);
  });

  // LOW (2026-05-31 punch list): TTL clamp used to treat explicit
  // `null` like an omitted field and silently substitute the default.
  // A caller passing `ttlSeconds: null` (DTO bug, hand-rolled JSON,
  // etc.) now gets a clear error instead of an unexpected 3600s token.
  it('rejects explicit null ttlSeconds with a finite-number error', async () => {
    await expect(
      service.mintTrackerToken(
        { tournamentId: TOURNAMENT_ID, ttlSeconds: null as any },
        { providerId: PROVIDER_ID },
        makeContext(),
      ),
    ).rejects.toThrow(/finite number \(received null\)/);
  });

  it('still defaults to 3600s when ttlSeconds is omitted entirely', async () => {
    // Sanity check that we did not also break the canonical default path.
    const result = await service.mintTrackerToken(
      { tournamentId: TOURNAMENT_ID },
      { providerId: PROVIDER_ID },
      makeContext(),
    );
    const decoded: any = await mockJwtService.verifyAsync(result.token);
    expect(decoded.exp - decoded.iat).toBe(3600);
  });

  describe('mintProviderScoringToken', () => {
    it('mints a provider-audience token carrying the scorer identity + scope', async () => {
      const result = await service.mintProviderScoringToken(
        { tournamentId: TOURNAMENT_ID, personId: 'person-1', displayName: 'Ivy ION', verified: true, ttlSeconds: 3600 },
        { providerId: PROVIDER_ID },
        makeContext(),
      );
      const decoded: any = await mockJwtService.verifyAsync(result.token);
      expect(decoded.aud).toBe('provider');
      expect(decoded.tournamentId).toBe(TOURNAMENT_ID);
      expect(decoded.providerId).toBe(PROVIDER_ID);
      expect(decoded.personId).toBe('person-1');
      expect(decoded.email_verified).toBe(true);
    });

    it('rejects when personId is missing', async () => {
      await expect(
        service.mintProviderScoringToken(
          { tournamentId: TOURNAMENT_ID, personId: '' },
          { providerId: PROVIDER_ID },
          makeContext(),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when the caller does not own the tournament', async () => {
      await expect(
        service.mintProviderScoringToken(
          { tournamentId: TOURNAMENT_ID, personId: 'person-1' },
          { providerId: 'other-provider' },
          makeContext({ providerRoles: { 'other-provider': 'PROVIDER_ADMIN' }, providerIds: ['other-provider'] }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('writes the audit row with provider audience', async () => {
      await service.mintProviderScoringToken(
        { tournamentId: TOURNAMENT_ID, personId: 'person-1' },
        { providerId: PROVIDER_ID, userId: 'u-key' },
        makeContext(),
      );
      expect(mockAuditService.recordTrackerTokenIssued).toHaveBeenCalledWith(
        expect.objectContaining({ tournamentId: TOURNAMENT_ID, providerId: PROVIDER_ID, audience: 'provider' }),
      );
    });
  });
});
