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

export interface MintTrackerTokenParams {
  tournamentId: string;
  ttlSeconds?: number;
}

export interface MintTrackerTokenResult {
  token: string;
  expiresAt: string; // ISO-8601
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
    user: { userId?: string; providerId?: string },
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
    try {
      await this.auditService.recordTrackerTokenIssued({
        tournamentId,
        providerId: user.providerId,
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

  private clampTtl(raw: number | undefined): number {
    if (raw === undefined || raw === null) return DEFAULT_TTL_SECONDS;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      throw new BadRequestException('ttlSeconds must be a finite number');
    }
    if (raw < MIN_TTL_SECONDS) {
      throw new BadRequestException(`ttlSeconds below the floor of ${MIN_TTL_SECONDS}s`);
    }
    if (raw > MAX_TTL_SECONDS) {
      throw new BadRequestException(`ttlSeconds above the ceiling of ${MAX_TTL_SECONDS}s (8h)`);
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
