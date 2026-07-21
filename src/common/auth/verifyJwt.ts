import { UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtVerifyOptions } from '@nestjs/jwt';

import { JWT_ASYM_ALG, getVerificationKey } from './jwtKeys';

/**
 * Read the (unverified) JWT header to select the algorithm + key. Decoding the
 * header segment directly — rather than via `jwtService.decode` — keeps this a
 * pure function of the token string, so every verify site works without adding
 * a `decode` stub to its JwtService mock. The header is used ONLY to pick the
 * key/alg; `verifyAsync` below still cryptographically verifies the signature
 * and pins the algorithm.
 */
function decodeHeader(token: string): { alg?: string; kid?: string } | null {
  const segment = token?.split('.')[0];
  if (!segment) return null;
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Single verification entry point for every trusted JWT in the mutation
 * server. During the HS256 → ES256 migration (Phase 1 — see
 * Mentat/planning/JWT_SIGNING_AUTHORITY_DECOUPLING.md) it **dual-accepts**:
 *
 *   - `ES256` tokens are verified against the public key resolved by their
 *     `kid` header (the JWKS material). Fail-closed on an unknown/absent kid —
 *     never silently fall back to the HS secret.
 *   - `HS256` tokens are verified against the legacy shared `JWT_SECRET`.
 *   - `alg: none` and any other algorithm are hard-rejected (downgrade guard).
 *
 * It is a pure function over the injected `JwtService` (not a new provider) so
 * every existing verify site — the guards, `auth.middleware` via
 * `AuthService.decode`, `identity.service`, `provisioner.middleware` — routes
 * through one policy without new DI wiring or changes to their test
 * construction. Centralising the algorithm/key decision here is the guard
 * against inconsistent per-call verify options.
 *
 * NOTE on key passing: the global `JwtModule` is registered with an HS
 * `secret`, and `@nestjs/jwt`'s `getSecretKey` resolves `options.secret ||
 * this.options.secret` before it ever looks at `options.publicKey` — so a
 * `publicKey` option is shadowed by the global secret. The ES256 public key is
 * therefore passed via the `secret` option (jsonwebtoken treats it as
 * secretOrPublicKey). Verified empirically.
 */
export async function verifyJwt<T extends object = any>(
  jwtService: JwtService,
  token: string,
  options?: JwtVerifyOptions,
): Promise<T> {
  const header = decodeHeader(token);
  const alg = header?.alg;
  if (!alg) throw new UnauthorizedException('Malformed token');
  if (alg === 'none') throw new UnauthorizedException('Unsigned tokens are not accepted');

  if (alg === JWT_ASYM_ALG) {
    const key = getVerificationKey(header?.kid);
    if (!key) throw new UnauthorizedException('Unknown token signing key');
    return jwtService.verifyAsync<T>(token, {
      ...options,
      secret: key as any,
      algorithms: [JWT_ASYM_ALG],
    });
  }

  if (alg === 'HS256') {
    // Step 4 of the migration: once ES256 tokens have drained in, set
    // JWT_ACCEPT_HS256=false to reject the legacy algorithm entirely (a
    // reversible config toggle rather than a code deploy). Default: accept.
    if (process.env.JWT_ACCEPT_HS256 === 'false') {
      throw new UnauthorizedException('HS256 tokens are no longer accepted');
    }
    // No explicit secret: fall through to the JwtService instance's configured
    // secret (the global JwtModule's `JWT_SECRET` in prod). This matches every
    // pre-migration verify site — the guards passed `process.env.JWT_SECRET`
    // and AuthService/identity relied on the instance secret; in prod they are
    // the same value, and it keeps the per-test JwtService secret working.
    return jwtService.verifyAsync<T>(token, { ...options, algorithms: ['HS256'] });
  }

  throw new UnauthorizedException(`Token algorithm ${alg} is not accepted`);
}
