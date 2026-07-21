import { generateKeyPairSync } from 'crypto';

import { getJwks, getVerificationKey, hasAsymmetricKeys, resetKeyCacheForTests } from './jwtKeys';

describe('jwtKeys (ES256 public key material + JWKS)', () => {
  const origEnv = { ...process.env };

  function setKeys(current?: { pem: string; kid: string }, previous?: { pem: string; kid: string }) {
    delete process.env.JWT_PUBLIC_KEY;
    delete process.env.JWT_KID;
    delete process.env.JWT_PUBLIC_KEY_PREVIOUS;
    delete process.env.JWT_KID_PREVIOUS;
    if (current) {
      process.env.JWT_PUBLIC_KEY = current.pem;
      process.env.JWT_KID = current.kid;
    }
    if (previous) {
      process.env.JWT_PUBLIC_KEY_PREVIOUS = previous.pem;
      process.env.JWT_KID_PREVIOUS = previous.kid;
    }
    resetKeyCacheForTests();
  }

  function makeKey(): string {
    return generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({
      type: 'spki',
      format: 'pem',
    }) as string;
  }

  afterEach(() => {
    process.env = { ...origEnv };
    resetKeyCacheForTests();
  });

  it('reports no asymmetric keys and an empty JWKS when unconfigured', () => {
    setKeys(undefined);
    expect(hasAsymmetricKeys()).toBe(false);
    expect(getJwks()).toEqual({ keys: [] });
    expect(getVerificationKey('anything')).toBeNull();
  });

  it('publishes the current public key as a JWK and resolves it by kid', () => {
    setKeys({ pem: makeKey(), kid: 'kid-current' });
    expect(hasAsymmetricKeys()).toBe(true);
    const { keys } = getJwks();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ kid: 'kid-current', kty: 'EC', use: 'sig', alg: 'ES256', crv: 'P-256' });
    expect(getVerificationKey('kid-current')).not.toBeNull();
  });

  it('publishes current + previous keys during rotation and resolves both', () => {
    setKeys({ pem: makeKey(), kid: 'kid-new' }, { pem: makeKey(), kid: 'kid-old' });
    const { keys } = getJwks();
    expect(keys.map((k) => k.kid)).toEqual(['kid-new', 'kid-old']);
    expect(getVerificationKey('kid-new')).not.toBeNull();
    expect(getVerificationKey('kid-old')).not.toBeNull();
  });

  it('never exposes private material in the JWK (public only)', () => {
    setKeys({ pem: makeKey(), kid: 'kid-current' });
    // 'd' is the EC private scalar — must be absent from a published JWK.
    expect(getJwks().keys[0]).not.toHaveProperty('d');
  });

  it('returns null for an unknown or absent kid', () => {
    setKeys({ pem: makeKey(), kid: 'kid-current' });
    expect(getVerificationKey('nope')).toBeNull();
    expect(getVerificationKey(undefined)).toBeNull();
  });
});
