import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';

import { REFRESH_TOKEN_STORAGE, type IRefreshTokenStorage } from 'src/storage/interfaces';

/** Refresh-token lifetime. Long-lived so a session survives a multi-day event. */
export const REFRESH_TOKEN_TTL_DAYS = 30;
const REFRESH_TOKEN_TTL_MS = REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
/** Human-recognisable prefix for the opaque token (purely cosmetic — it is hashed). */
const REFRESH_TOKEN_PREFIX = 'rtok_';

export interface RotationResult {
  userId: string;
  email: string;
  /** The freshly minted plaintext refresh token to hand back to the client. */
  refreshToken: string;
}

/**
 * Issues, rotates, and revokes opaque refresh tokens. The plaintext token is
 * returned to the caller exactly once; only its SHA-256 hash is persisted.
 *
 * Rotation: every successful refresh mints a new token in the same family and
 * revokes the one presented. Replaying an already-rotated (revoked) token is
 * treated as theft — the entire family is revoked so both the attacker's and
 * the victim's tokens stop working and the user is forced to re-authenticate.
 *
 * Shared by AuthService (password login) and SsoController (provisioner
 * handoff); it depends only on the globally-exported REFRESH_TOKEN_STORAGE.
 */
@Injectable()
export class RefreshTokenService {
  constructor(@Inject(REFRESH_TOKEN_STORAGE) private readonly storage: IRefreshTokenStorage) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private mint(): string {
    return REFRESH_TOKEN_PREFIX + randomBytes(32).toString('base64url');
  }

  private expiry(): string {
    return new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString();
  }

  /** Issue a brand-new refresh token that starts a fresh rotation family. */
  async issue(userId: string, email: string, userAgent?: string): Promise<string> {
    const token = this.mint();
    await this.storage.create({
      userId,
      email,
      tokenHash: this.hash(token),
      familyId: randomUUID(),
      expiresAt: this.expiry(),
      userAgent,
    });
    return token;
  }

  /**
   * Validate a presented refresh token and rotate it. Returns the owning user
   * plus a fresh refresh token (same family). Throws UnauthorizedException for
   * unknown / expired / revoked tokens. A revoked-token replay revokes the
   * whole family (reuse detection).
   */
  async rotate(presented: string, userAgent?: string): Promise<RotationResult> {
    if (!presented) throw new UnauthorizedException('Missing refresh token');

    const row = await this.storage.findByHash(this.hash(presented));
    if (!row) throw new UnauthorizedException('Invalid refresh token');

    if (row.revokedAt) {
      Logger.warn(
        `Refresh-token reuse detected for user ${row.userId}; revoking family ${row.familyId}`,
        RefreshTokenService.name,
      );
      await this.storage.revokeFamily(row.familyId);
      throw new UnauthorizedException('Refresh token already used');
    }

    if (new Date(row.expiresAt).getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // Rotate within the same family, then revoke the presented token and link
    // it to its successor for audit/forensics.
    const next = this.mint();
    const created = await this.storage.create({
      userId: row.userId,
      email: row.email,
      tokenHash: this.hash(next),
      familyId: row.familyId,
      expiresAt: this.expiry(),
      userAgent,
    });
    await this.storage.revoke(row.tokenId, created.tokenId);

    return { userId: row.userId, email: row.email, refreshToken: next };
  }

  /** Revoke a single presented refresh token (logout). Idempotent and quiet. */
  async revoke(presented: string): Promise<void> {
    if (!presented) return;
    const row = await this.storage.findByHash(this.hash(presented));
    if (row && !row.revokedAt) await this.storage.revoke(row.tokenId);
  }

  /** Revoke every active refresh token for a user (credential change / logout-all). */
  async revokeAllForUser(userId: string): Promise<void> {
    if (!userId) return;
    await this.storage.revokeAllForUser(userId);
  }
}
