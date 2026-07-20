/**
 * TrackerTokenService — mints short-lived HS256 JWTs for the
 * score-relay `/tracker` namespace.
 *
 * Workflow (POST /auth/tracker-token):
 *   1. RolesGuard admits SCORE / SUPER_ADMIN callers (provider API-key
 *      middleware synthesizes [CLIENT, GENERATE, SCORE]).
 *   2. Service loads the tournament and runs canMutateTournament against
 *      the caller's userContext. Only the owning provider can mint a
 *      token for its tournament.
 *   3. Service mints an `aud: score` JWT with `tournamentId` and a
 *      caller-controlled TTL (clamped 60-28800s, default 3600s).
 *   4. Service appends a TRACKER_TOKEN_ISSUED audit row.
 *
 * The relay's TrackerAuthError surface (missing-tournament-id,
 * audience-mismatch, expired) is the final gate. Anything that passes
 * mint here AND has a non-expired signature there will be accepted.
 */
import { ForbiddenException, Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { AuditService } from '../../audit/audit.service';
import type { UserContext } from './decorators/user-context.decorator';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { canMutateTournament } from '../../factory/helpers/checkTournamentAccess';

const DEFAULT_TTL_SECONDS = 3600;
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 28800; // 8 hours
// Scorer tokens (HiveID end-user, single crowd-scoring session) get a tighter
// ceiling than provider tokens: a leaked score token should not outlive a match.
const SCORER_MAX_TTL_SECONDS = 14400; // 4 hours

export interface MintTrackerTokenParams {
  tournamentId: string;
  ttlSeconds?: number;
}

export interface MintTrackerTokenResult {
  token: string;
  expiresAt: string; // ISO-8601
}

export interface MintProviderScoringTokenParams {
  tournamentId: string;
  /** Canonical Person id of the scorer the provider is attesting. */
  personId: string;
  displayName?: string;
  /** Provider attests the scorer is verified (gates TMX nomination). */
  verified?: boolean;
  ttlSeconds?: number;
}

export interface MintScorerTokenParams {
  tournamentId: string;
  /** When set, the relay binds the token to this single matchUp. */
  matchUpId?: string;
  /** Cosmetic attribution only — never a trust gate. */
  displayName?: string;
  ttlSeconds?: number;
}

/**
 * The caller's own HiveID session identity, read from the verified session JWT
 * (`req.user`) — NEVER from the request body. A HiveID user may only assert
 * themselves; unlike the provider mint, no one attests on another's behalf.
 */
export interface ScorerIdentity {
  userId?: string;
  personId?: string;
  /** The session's `email_verified` claim — carried onto the score token. */
  verified: boolean;
}

@Injectable()
export class TrackerTokenService {
  private readonly logger = new Logger(TrackerTokenService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly tournamentStorageService: TournamentStorageService,
    private readonly auditService: AuditService,
  ) {}

  async mintTrackerToken(
    params: MintTrackerTokenParams,
    user: { userId?: string; providerId?: string; provisionerId?: string },
    userContext: UserContext | undefined,
  ): Promise<MintTrackerTokenResult> {
    const tournamentId = params.tournamentId?.trim();
    if (!tournamentId) {
      throw new BadRequestException('tournamentId is required');
    }

    const ttlSeconds = this.clampTtl(params.ttlSeconds);

    const tournament = await this.loadTournament(tournamentId);
    if (!tournament) throw new NotFoundException(`tournament ${tournamentId} not found`);

    // Ownership gate — same predicate that protects /factory/score.
    if (!canMutateTournament(tournament, userContext)) {
      throw new ForbiddenException('caller does not own this tournament');
    }

    const sub = user.providerId ? `provider:${user.providerId}` : user.userId ?? 'unknown';
    const now = Math.floor(Date.now() / 1000);
    const exp = now + ttlSeconds;

    // jsonwebtoken refuses both `exp` in payload AND `expiresIn` in
    // options. The AuthModule registers a global signOptions.expiresIn
    // ('2h' from JWT_VALIDITY env), so we MUST NOT put `exp` in the
    // payload — instead override expiresIn at the call site with our
    // variable TTL. `expiresAt` in the response is derived from our
    // own `exp` value, which matches what jsonwebtoken will stamp.
    const token = await this.jwtService.signAsync(
      { sub, aud: 'score', tournamentId, iat: now },
      { expiresIn: ttlSeconds },
    );

    const expiresAt = new Date(exp * 1000).toISOString();

    // Audit the mint. Fail-soft: a write failure here must not leak the
    // token into the wild and back again — but it also must not drop a
    // successful authorization. We log + continue.
    //
    // For provisioner-keyed requests, the JWT subject still names the
    // tenant provider (relay-side audience scope), but the audit row
    // must attribute the mint to the provisioner — the principal that
    // authorized the API call. Without forwarding provisionerId, an
    // IONSport mint via X-Provider-Id: BOBOCA logs the row as a BOBOCA
    // action, and the audit trail can't bound a provisioner's reach.
    try {
      await this.auditService.recordTrackerTokenIssued({
        tournamentId,
        providerId: user.providerId,
        provisionerId: user.provisionerId,
        audience: 'score',
        ttlSeconds,
        expiresAt,
        userId: user.userId,
      });
    } catch (err) {
      this.logger.warn(`trackerTokenIssued audit failed: ${(err as Error).message}`);
    }

    return { token, expiresAt };
  }

  /**
   * Mint a `provider`-audience relay token so a provider's own client app
   * (e.g. IONSport) can be a first-class score-relay client. The token is
   * scoped to a single tournament (the relay enforces that scope from the
   * `tournamentId` claim with no DB lookup) and carries the provider-attested
   * scorer identity so TMX classifies + nominates it like any HiveID scorer.
   */
  async mintProviderScoringToken(
    params: MintProviderScoringTokenParams,
    user: { userId?: string; providerId?: string; provisionerId?: string },
    userContext: UserContext | undefined,
  ): Promise<MintTrackerTokenResult> {
    const tournamentId = params.tournamentId?.trim();
    if (!tournamentId) throw new BadRequestException('tournamentId is required');
    const personId = params.personId?.trim();
    if (!personId) throw new BadRequestException('personId is required');

    const ttlSeconds = this.clampTtl(params.ttlSeconds);

    const tournament = await this.loadTournament(tournamentId);
    if (!tournament) throw new NotFoundException(`tournament ${tournamentId} not found`);
    if (!canMutateTournament(tournament, userContext)) {
      throw new ForbiddenException('caller does not own this tournament');
    }

    const sub = user.providerId ? `provider:${user.providerId}` : user.userId ?? 'unknown';
    const now = Math.floor(Date.now() / 1000);
    const exp = now + ttlSeconds;
    const token = await this.jwtService.signAsync(
      {
        sub,
        aud: 'provider',
        tournamentId,
        providerId: user.providerId,
        personId,
        displayName: params.displayName,
        email_verified: params.verified === true,
        iat: now,
      },
      { expiresIn: ttlSeconds },
    );
    const expiresAt = new Date(exp * 1000).toISOString();

    try {
      await this.auditService.recordTrackerTokenIssued({
        tournamentId,
        providerId: user.providerId,
        provisionerId: user.provisionerId,
        audience: 'provider',
        ttlSeconds,
        expiresAt,
        userId: user.userId,
      });
    } catch (err) {
      this.logger.warn(`providerScoringTokenIssued audit failed: ${(err as Error).message}`);
    }

    return { token, expiresAt };
  }

  /**
   * Mint a `score`-audience relay token for an authenticated HiveID end-user so
   * that a launched external scorer (epixodic) can relay crowd scores AS that
   * person — replacing the full session JWT that used to travel in the launch
   * URL. Unlike the provider mints this does NOT check tournament ownership and
   * reads NO tournament record: a HiveID participant is not a provider and may
   * only assert their own identity. The token grants nothing against CFS (no
   * route accepts `aud: 'score'`); its only power is crowd-score attribution at
   * the relay `/crowd` namespace, where the TD still gates acceptance in TMX.
   *
   * `personId` + `verified` come from the caller's verified session (never the
   * body). A session with no linked Person cannot be attributed and is rejected.
   */
  async mintScorerToken(params: MintScorerTokenParams, identity: ScorerIdentity): Promise<MintTrackerTokenResult> {
    const tournamentId = params.tournamentId?.trim();
    if (!tournamentId) throw new BadRequestException('tournamentId is required');
    const personId = identity.personId?.trim();
    if (!personId) throw new BadRequestException('HiveID session has no linked Person to attribute scores to');

    const matchUpId = params.matchUpId?.trim() || undefined;
    const ttlSeconds = this.clampTtl(params.ttlSeconds, SCORER_MAX_TTL_SECONDS);

    const sub = identity.userId ?? 'unknown';
    const now = Math.floor(Date.now() / 1000);
    const exp = now + ttlSeconds;
    const token = await this.jwtService.signAsync(
      {
        sub,
        aud: 'score',
        tournamentId,
        matchUpId,
        personId,
        displayName: params.displayName,
        email_verified: identity.verified === true,
        iat: now,
      },
      { expiresIn: ttlSeconds },
    );
    const expiresAt = new Date(exp * 1000).toISOString();

    try {
      await this.auditService.recordTrackerTokenIssued({
        tournamentId,
        audience: 'score',
        ttlSeconds,
        expiresAt,
        userId: identity.userId,
      });
    } catch (err) {
      this.logger.warn(`scorerTokenIssued audit failed: ${(err as Error).message}`);
    }

    return { token, expiresAt };
  }

  private clampTtl(raw: number | undefined, maxSeconds: number = MAX_TTL_SECONDS): number {
    // Omitted (undefined) means "use the default". Explicit null is a
    // caller-side bug — most likely a DTO field that wasn't supposed to
    // be sent — so we reject loudly rather than silently substituting
    // the default. This used to be lumped with undefined and produced
    // surprising "I asked for null and got 3600" behavior.
    if (raw === undefined) return DEFAULT_TTL_SECONDS;
    if (raw === null) {
      throw new BadRequestException('ttlSeconds must be a finite number (received null)');
    }
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      throw new BadRequestException('ttlSeconds must be a finite number');
    }
    if (raw < MIN_TTL_SECONDS) {
      throw new BadRequestException(`ttlSeconds below the floor of ${MIN_TTL_SECONDS}s`);
    }
    if (raw > maxSeconds) {
      throw new BadRequestException(`ttlSeconds above the ceiling of ${maxSeconds}s`);
    }
    return Math.floor(raw);
  }

  private async loadTournament(tournamentId: string): Promise<any | undefined> {
    const result: any = await this.tournamentStorageService.fetchTournamentRecords({
      tournamentIds: [tournamentId],
    });
    return result?.tournamentRecords?.[tournamentId];
  }
}
