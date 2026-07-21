import { JwtService } from '@nestjs/jwt';
import { generateKeyPairSync } from 'crypto';

import { signJwt, isEs256SigningEnabled, resetSigningKeyCacheForTests } from './signJwt';
import { verifyJwt } from './verifyJwt';
import { resetKeyCacheForTests } from './jwtKeys';

/**
 * Signer flip tests (Mentat/planning/JWT_SIGNING_AUTHORITY_DECOUPLING.md, step 3).
 * The signer is flag-gated (JWT_SIGN_ES256) and interops with the dual-accept
 * verifier: a signJwt-minted ES256 token must verify via verifyJwt.
 */
describe('signJwt (flag-gated ES256 signer)', () => {
  const HS_SECRET = 'hs-legacy-secret';
  const KID = 'es256-signer-test';
  const origEnv = { ...process.env };
  let hsService: JwtService;

  const headerAlg = (token: string): string => JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()).alg;

  beforeAll(() => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    process.env.JWT_SECRET = HS_SECRET;
    process.env.JWT_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }) as string;
    process.env.JWT_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    process.env.JWT_KID = KID;
    hsService = new JwtService({ secret: HS_SECRET, signOptions: { expiresIn: '1d' } });
  });

  afterAll(() => {
    process.env = origEnv;
    resetSigningKeyCacheForTests();
    resetKeyCacheForTests();
  });

  function setFlag(on: boolean) {
    if (on) process.env.JWT_SIGN_ES256 = 'true';
    else delete process.env.JWT_SIGN_ES256;
    resetSigningKeyCacheForTests();
    resetKeyCacheForTests();
  }

  it('signs HS256 when the flag is off (unchanged legacy behavior)', async () => {
    setFlag(false);
    expect(isEs256SigningEnabled()).toBe(false);
    const token = await signJwt(hsService, { email: 'a@test.com' }, { expiresIn: '4h' });
    expect(headerAlg(token)).toBe('HS256');
  });

  it('signs ES256 with a kid header when the flag is on and a key is present', async () => {
    setFlag(true);
    expect(isEs256SigningEnabled()).toBe(true);
    const token = await signJwt(hsService, { email: 'b@test.com', aud: 'admin' }, { expiresIn: '4h' });
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
    expect(header.alg).toBe('ES256');
    expect(header.kid).toBe(KID);
  });

  it('an ES256 token minted by signJwt verifies via the dual-accept verifyJwt', async () => {
    setFlag(true);
    const token = await signJwt(hsService, { email: 'c@test.com', aud: 'admin', sub: 'u-1' });
    const payload: any = await verifyJwt(hsService, token);
    expect(payload.email).toBe('c@test.com');
    expect(payload.sub).toBe('u-1');
    expect(typeof payload.exp).toBe('number'); // instance default expiresIn applied
  });

  it('falls back to HS256 when the flag is on but no signing key is configured', async () => {
    const savedPriv = process.env.JWT_PRIVATE_KEY;
    delete process.env.JWT_PRIVATE_KEY;
    process.env.JWT_SIGN_ES256 = 'true';
    resetSigningKeyCacheForTests();
    expect(isEs256SigningEnabled()).toBe(false);
    const token = await signJwt(hsService, { email: 'd@test.com' });
    expect(headerAlg(token)).toBe('HS256');
    process.env.JWT_PRIVATE_KEY = savedPriv;
    resetSigningKeyCacheForTests();
  });

  it('a legacy HS256 token still verifies during the dual-accept window', async () => {
    setFlag(true);
    const legacy = await hsService.signAsync({ email: 'legacy@test.com' });
    const payload: any = await verifyJwt(hsService, legacy);
    expect(payload.email).toBe('legacy@test.com');
  });
});
