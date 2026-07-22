/**
 * SplitTokenSigner — unit tests for the two modes:
 *  - local (HIVEID_BASE_URL unset): signs via the passed JwtService (current behavior)
 *  - remote (HIVEID_BASE_URL set): POSTs to the IdP /internal/mint, fails closed
 */
import { JwtService } from '@nestjs/jwt';

import { SplitTokenSigner } from './split-token-signer.service';

const savedEnv = { ...process.env };

function decode(token: string): Record<string, any> {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

describe('SplitTokenSigner', () => {
  afterEach(() => {
    process.env = { ...savedEnv };
    jest.restoreAllMocks();
  });

  describe('local mode (HIVEID_BASE_URL unset)', () => {
    beforeEach(() => {
      delete process.env.HIVEID_BASE_URL;
      delete process.env.JWT_SIGN_ES256;
    });

    it('is not remote and signs locally with the passed JwtService', async () => {
      const jwt = new JwtService({ secret: 'test-secret', signOptions: { expiresIn: '1d' } });
      const signer = new SplitTokenSigner();
      expect(signer.isRemote()).toBe(false);

      const token = await signer.mint(jwt, {
        claims: { sub: 'provider:BOBOCA', tournamentId: 't-1', iat: Math.floor(Date.now() / 1000) },
        audience: 'score',
        expiresInSeconds: 3600,
      });
      const payload = decode(token);
      expect(payload).toMatchObject({ sub: 'provider:BOBOCA', tournamentId: 't-1', aud: 'score' });
      expect(payload.exp - payload.iat).toBe(3600);
      // A locally-signed token the same JwtService verifies.
      await expect(jwt.verifyAsync(token)).resolves.toMatchObject({ aud: 'score' });
    });

    it('does not call fetch in local mode', async () => {
      const jwt = new JwtService({ secret: 'test-secret', signOptions: { expiresIn: '1d' } });
      const fetchSpy = jest.spyOn(globalThis, 'fetch' as any);
      await new SplitTokenSigner().mint(jwt, { claims: { sub: 'u' }, audience: 'admin', expiresInSeconds: 60 });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('remote mode (HIVEID_BASE_URL set)', () => {
    beforeEach(() => {
      process.env.HIVEID_BASE_URL = 'http://idp.local:3140';
      process.env.HIVEID_SIGNER_TOKEN = 'signer-secret';
    });

    it('is remote and POSTs the mint request with the service token, returning the IdP token', async () => {
      const jwt = new JwtService({ secret: 'test-secret' });
      const fetchSpy = jest
        .spyOn(globalThis, 'fetch' as any)
        .mockResolvedValue({ ok: true, json: async () => ({ token: 'idp.signed.token' }) } as any);

      const signer = new SplitTokenSigner();
      expect(signer.isRemote()).toBe(true);

      const token = await signer.mint(jwt, { claims: { sub: 'u', tournamentId: 't' }, audience: 'provider', expiresInSeconds: 120 });
      expect(token).toBe('idp.signed.token');

      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('http://idp.local:3140/internal/mint');
      expect((init as any).headers['x-service-token']).toBe('signer-secret');
      expect(JSON.parse((init as any).body)).toEqual({
        claims: { sub: 'u', tournamentId: 't' },
        audience: 'provider',
        expiresIn: 120,
      });
    });

    it('fails closed when the IdP rejects (non-2xx) — never falls back to a local key', async () => {
      const jwt = new JwtService({ secret: 'test-secret' });
      jest.spyOn(globalThis, 'fetch' as any).mockResolvedValue({ ok: false, status: 503 } as any);
      await expect(
        new SplitTokenSigner().mint(jwt, { claims: { sub: 'u' }, audience: 'score', expiresInSeconds: 60 }),
      ).rejects.toThrow('token signer unavailable');
    });

    it('fails closed when the IdP is unreachable', async () => {
      const jwt = new JwtService({ secret: 'test-secret' });
      jest.spyOn(globalThis, 'fetch' as any).mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(
        new SplitTokenSigner().mint(jwt, { claims: { sub: 'u' }, audience: 'score', expiresInSeconds: 60 }),
      ).rejects.toThrow('token signer unavailable');
    });

    it('fails closed when the IdP returns no token', async () => {
      const jwt = new JwtService({ secret: 'test-secret' });
      jest.spyOn(globalThis, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => ({}) } as any);
      await expect(
        new SplitTokenSigner().mint(jwt, { claims: { sub: 'u' }, audience: 'score', expiresInSeconds: 60 }),
      ).rejects.toThrow('token signer unavailable');
    });

    it('treats HIVEID_BASE_URL=disabled as local (explicit override)', async () => {
      process.env.HIVEID_BASE_URL = 'disabled';
      expect(new SplitTokenSigner().isRemote()).toBe(false);
    });
  });
});
