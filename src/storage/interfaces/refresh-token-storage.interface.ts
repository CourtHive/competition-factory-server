export const REFRESH_TOKEN_STORAGE = Symbol('REFRESH_TOKEN_STORAGE');

/**
 * Storage for opaque refresh tokens backing the access/refresh session model.
 *
 * Only the SHA-256 *hash* of a refresh token is ever stored — the plaintext
 * lives solely in the client's localStorage. Tokens are rotated on every use:
 * each rotation issues a new row in the same `familyId` and revokes the prior
 * one. Presenting an already-revoked token in a family is treated as theft and
 * triggers `revokeFamily` (see RefreshTokenService.rotate).
 */
export interface IRefreshTokenStorage {
  /** Persist a new refresh token (hash only). Returns the stored row. */
  create(input: {
    userId: string;
    email: string;
    tokenHash: string;
    familyId: string;
    expiresAt: string;
    userAgent?: string;
  }): Promise<RefreshTokenRow>;

  /** Look up a token by its hash, regardless of state. Caller inspects revoked/expired. */
  findByHash(tokenHash: string): Promise<RefreshTokenRow | null>;

  /** Mark a single token revoked, optionally recording the token that replaced it on rotation. */
  revoke(tokenId: string, replacedBy?: string): Promise<void>;

  /** Revoke every still-active token in a rotation family (reuse / breach response). */
  revokeFamily(familyId: string): Promise<void>;

  /** Revoke every still-active token for a user (logout-all / credential change). */
  revokeAllForUser(userId: string): Promise<void>;

  /** Delete already-expired rows. Returns the number removed. */
  deleteExpired(): Promise<number>;
}

export interface RefreshTokenRow {
  tokenId: string;
  userId: string;
  email: string;
  tokenHash: string;
  familyId: string;
  expiresAt: string;
  createdAt?: string;
  revokedAt?: string | null;
  replacedBy?: string | null;
  userAgent?: string | null;
}
