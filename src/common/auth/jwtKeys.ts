import { createPublicKey, type KeyObject } from 'crypto';

/**
 * Asymmetric (ES256) PUBLIC key material for the JWT signing-authority
 * decoupling (Phase 1 — see Mentat/planning/JWT_SIGNING_AUTHORITY_DECOUPLING.md).
 *
 * Neutral verify-side infra: the mutation server keeps verifying tokens after
 * the account tree lifts out, so the verify primitive + its public keys live
 * outside `account/`. The private signing key is signer-side (added with the
 * Step 3 signer flip, under `account/`).
 *
 * During the dual-accept migration the asymmetric material is OPTIONAL — when
 * the env vars are absent, `getVerificationKey`/`getJwks` report "no asym keys"
 * and callers fall back to the legacy HS256 path. This keeps isolated dev (no
 * keys) working and makes the verifier-first rollout a no-op until keys are
 * provisioned.
 *
 * Env:
 *   JWT_KID, JWT_PUBLIC_KEY               — current verify key (PEM SPKI)
 *   JWT_KID_PREVIOUS, JWT_PUBLIC_KEY_PREVIOUS — previous key kept during rotation (optional)
 */

export const JWT_ASYM_ALG = 'ES256' as const;

export interface PublicKeyEntry {
  kid: string;
  key: KeyObject;
  /** JWK form (public) for the JWKS endpoint. */
  jwk: Record<string, unknown>;
}

let cachedPublic: PublicKeyEntry[] | undefined;

function toEntry(pem: string | undefined, kid: string | undefined): PublicKeyEntry | null {
  if (!pem || !kid) return null;
  // PEM-in-env commonly arrives with literal "\n" escapes (single-line env
  // values) rather than real newlines; normalise so `createPublicKey` accepts
  // either form. Real-newline PEMs are unaffected.
  const key = createPublicKey(pem.replace(/\\n/g, '\n'));
  const jwk = { ...key.export({ format: 'jwk' }), kid, use: 'sig', alg: JWT_ASYM_ALG };
  return { kid, key, jwk };
}

/** Ordered current-then-previous public keys present in the environment. */
export function getPublicKeys(): PublicKeyEntry[] {
  if (cachedPublic !== undefined) return cachedPublic;
  const entries = [
    toEntry(process.env.JWT_PUBLIC_KEY, process.env.JWT_KID),
    toEntry(process.env.JWT_PUBLIC_KEY_PREVIOUS, process.env.JWT_KID_PREVIOUS),
  ].filter((e): e is PublicKeyEntry => e !== null);
  cachedPublic = entries;
  return entries;
}

/** Resolve the public key matching `kid`, or null (fail-closed at the caller). */
export function getVerificationKey(kid: string | undefined): KeyObject | null {
  if (!kid) return null;
  return getPublicKeys().find((e) => e.kid === kid)?.key ?? null;
}

/** Whether any asymmetric verify key is configured (gates the asym branch). */
export function hasAsymmetricKeys(): boolean {
  return getPublicKeys().length > 0;
}

/** JWKS document for `GET /.well-known/jwks.json`. Empty `keys` when unconfigured. */
export function getJwks(): { keys: Record<string, unknown>[] } {
  return { keys: getPublicKeys().map((e) => e.jwk) };
}

/** Test-only: clears the memoized key material so env changes take effect. */
export function resetKeyCacheForTests(): void {
  cachedPublic = undefined;
}
