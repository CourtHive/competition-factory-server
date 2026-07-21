import { JwtService } from '@nestjs/jwt';
import { generateKeyPairSync } from 'crypto';

import { verifyJwt } from './verifyJwt';
import { resetKeyCacheForTests } from './jwtKeys';

/**
 * Dual-accept verifier tests for the HS256 -> ES256 migration
 * (Mentat/planning/JWT_SIGNING_AUTHORITY_DECOUPLING.md, Phase 1).
 */
describe('verifyJwt (dual-accept ES256 + legacy HS256)', () => {
  const HS_SECRET = 'hs-legacy-secret';
  const KID = 'test-kid-1';
  const origEnv = { ...process.env };

  let hsService: JwtService; // mirrors the prod global JwtModule (HS secret)
  let signer: JwtService; // no configured secret; signs ES256 via privateKey
  let privateKeyPem: string;

  const b64 = (obj: object): string => Buffer.from(JSON.stringify(obj)).toString('base64url');

  const signEs = (payload: object, kid: string = KID): Promise<string> =>
    signer.signAsync(payload, { algorithm: 'ES256', keyid: kid, expiresIn: '2h', privateKey: privateKeyPem } as any);

  beforeAll(() => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    process.env.JWT_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }) as string;
    process.env.JWT_KID = KID;
    process.env.JWT_SECRET = HS_SECRET;
    resetKeyCacheForTests();
    hsService = new JwtService({ secret: HS_SECRET });
    signer = new JwtService({});
  });

  afterAll(() => {
    process.env = origEnv;
    resetKeyCacheForTests();
  });

  it('accepts a legacy HS256 token signed with the instance secret', async () => {
    const token = await hsService.signAsync({ email: 'legacy@test.com', aud: 'admin' });
    const payload: any = await verifyJwt(hsService, token);
    expect(payload.email).toBe('legacy@test.com');
  });

  it('accepts an ES256 token whose kid resolves to the configured public key', async () => {
    const token = await signEs({ email: 'asym@test.com', aud: 'admin' });
    const payload: any = await verifyJwt(hsService, token);
    expect(payload.email).toBe('asym@test.com');
  });

  it('rejects an ES256 token with an unknown kid (fail-closed, no HS fallback)', async () => {
    const token = await signEs({ email: 'x@test.com' }, 'kid-does-not-exist');
    await expect(verifyJwt(hsService, token)).rejects.toThrow(/Unknown token signing key/);
  });

  it('rejects an alg:none (unsigned) token', async () => {
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ email: 'attacker@test.com' })}.`;
    await expect(verifyJwt(hsService, none)).rejects.toThrow(/Unsigned tokens are not accepted/);
  });

  it('rejects a token signed with an unaccepted algorithm (HS384)', async () => {
    const token = await hsService.signAsync({ email: 'hs384@test.com' }, { algorithm: 'HS384' } as any);
    await expect(verifyJwt(hsService, token)).rejects.toThrow(/not accepted/);
  });

  it('rejects a malformed token', async () => {
    await expect(verifyJwt(hsService, 'not-a-jwt')).rejects.toThrow(/Malformed token/);
  });

  it('rejects an HS256 token whose signature does not match the instance secret', async () => {
    const foreign = new JwtService({ secret: 'some-other-secret' });
    const token = await foreign.signAsync({ email: 'forged@test.com' });
    await expect(verifyJwt(hsService, token)).rejects.toThrow();
  });

  it('rejects a tampered ES256 token (payload swapped after signing)', async () => {
    const token = await signEs({ email: 'real@test.com', roles: ['client'] });
    const [h, , s] = token.split('.');
    const tampered = `${h}.${b64({ email: 'real@test.com', roles: ['admin'] })}.${s}`;
    await expect(verifyJwt(hsService, tampered)).rejects.toThrow();
  });

  it('rejects HS256 (but still accepts ES256) once JWT_ACCEPT_HS256=false (step 4 drain toggle)', async () => {
    process.env.JWT_ACCEPT_HS256 = 'false';
    try {
      const hs = await hsService.signAsync({ email: 'legacy@test.com' });
      await expect(verifyJwt(hsService, hs)).rejects.toThrow(/no longer accepted/);
      const es = await signEs({ email: 'asym@test.com', aud: 'admin' });
      const payload: any = await verifyJwt(hsService, es);
      expect(payload.email).toBe('asym@test.com');
    } finally {
      delete process.env.JWT_ACCEPT_HS256;
    }
  });
});
