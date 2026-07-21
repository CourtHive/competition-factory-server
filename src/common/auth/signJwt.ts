import { createPrivateKey, type KeyObject } from 'crypto';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';

/**
 * ES256 token signer for the signing-authority decoupling
 * (Mentat/planning/JWT_SIGNING_AUTHORITY_DECOUPLING.md, step 3).
 *
 * Signing is the signer-side half of the migration. It is **flag-gated**: the
 * server keeps minting legacy HS256 tokens until `JWT_SIGN_ES256=true` AND a
 * private key is present. This decouples *deploying the code* from *flipping
 * the signer* — deploy ships with the flag off (no behavior change), then the
 * cutover is a single env toggle (instantly reversible), by which point every
 * verifier already dual-accepts ES256.
 *
 * All mint sites route through `signJwt` so the algorithm decision lives in one
 * place. Currently neutral (in-process on the mutation server); when the
 * account tree lifts out to AMS, the signer + private key relocate there and
 * the mutation server stops signing entirely (verify-only).
 *
 * NOTE on key passing: the global `JwtModule` is registered with an HS `secret`,
 * which `@nestjs/jwt`'s `getSecretKey` resolves before `options.privateKey`, so
 * a `privateKey` option is shadowed. The ES256 private key is therefore passed
 * via the `secret` option (jsonwebtoken treats it as secretOrPrivateKey) —
 * verified empirically, symmetric with the verify side.
 */

let cachedSigningKey: { kid: string; key: KeyObject } | null | undefined;

/** Current ES256 signing key (private) + its `kid`, or null when unset. */
export function getSigningKey(): { kid: string; key: KeyObject } | null {
  if (cachedSigningKey !== undefined) return cachedSigningKey;
  const pem = process.env.JWT_PRIVATE_KEY;
  const kid = process.env.JWT_KID;
  if (!pem || !kid) {
    cachedSigningKey = null;
    return null;
  }
  try {
    cachedSigningKey = { kid, key: createPrivateKey(pem.replace(/\\n/g, '\n')) };
  } catch {
    cachedSigningKey = null;
  }
  return cachedSigningKey;
}

/** ES256 signing is active only when explicitly enabled AND a signing key is present. */
export function isEs256SigningEnabled(): boolean {
  return process.env.JWT_SIGN_ES256 === 'true' && getSigningKey() !== null;
}

/**
 * Sign a JWT. When ES256 signing is enabled, signs with the private key +
 * `ES256` + `kid` header; otherwise signs HS256 with the instance secret
 * (unchanged legacy behavior). Signing options (e.g. `expiresIn`) pass through.
 */
export async function signJwt(
  jwtService: JwtService,
  payload: object,
  options: JwtSignOptions = {},
): Promise<string> {
  const signing = isEs256SigningEnabled() ? getSigningKey() : null;
  if (signing) {
    return jwtService.signAsync(payload, {
      ...options,
      secret: signing.key as any,
      algorithm: 'ES256',
      keyid: signing.kid,
    });
  }
  return jwtService.signAsync(payload, options);
}

/** Test-only: clears the memoized signing key so env changes take effect. */
export function resetSigningKeyCacheForTests(): void {
  cachedSigningKey = undefined;
}
