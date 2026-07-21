import { generateKeyPairSync } from 'crypto';

import { resetKeyCacheForTests } from 'src/common/auth/jwtKeys';
import { JwksController } from './jwks.controller';

describe('JwksController', () => {
  const origEnv = { ...process.env };
  const controller = new JwksController();

  afterEach(() => {
    process.env = { ...origEnv };
    resetKeyCacheForTests();
  });

  it('serves an empty key set when no asymmetric key is configured', () => {
    delete process.env.JWT_PUBLIC_KEY;
    delete process.env.JWT_KID;
    resetKeyCacheForTests();
    expect(controller.getJwks()).toEqual({ keys: [] });
  });

  it('serves the current public JWK when configured', () => {
    const pem = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({
      type: 'spki',
      format: 'pem',
    }) as string;
    process.env.JWT_PUBLIC_KEY = pem;
    process.env.JWT_KID = 'kid-1';
    resetKeyCacheForTests();
    const jwks = controller.getJwks();
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toMatchObject({ kid: 'kid-1', kty: 'EC', alg: 'ES256' });
  });
});
