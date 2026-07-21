import { UnauthorizedException } from '@nestjs/common';
import { RefreshTokenService } from './refresh-token.service';

describe('RefreshTokenService', () => {
  let service: RefreshTokenService;
  let storage: any;

  const activeRow = (overrides: any = {}) => ({
    tokenId: 't-old',
    userId: 'u-1',
    email: 'a@test.com',
    tokenHash: 'hash',
    familyId: 'fam-1',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    revokedAt: null,
    ...overrides,
  });

  beforeEach(() => {
    storage = {
      create: jest.fn().mockImplementation(async (input) => ({ tokenId: 't-new', ...input })),
      findByHash: jest.fn(),
      revoke: jest.fn().mockResolvedValue(undefined),
      revokeFamily: jest.fn().mockResolvedValue(undefined),
      revokeAllForUser: jest.fn().mockResolvedValue(undefined),
      deleteExpired: jest.fn().mockResolvedValue(0),
    };
    service = new RefreshTokenService(storage);
  });

  describe('issue', () => {
    it('stores only a hash and returns a prefixed plaintext token', async () => {
      const token = await service.issue('u-1', 'a@test.com', 'agent');
      expect(token.startsWith('rtok_')).toBe(true);
      expect(storage.create).toHaveBeenCalledTimes(1);
      const arg = storage.create.mock.calls[0][0];
      expect(arg.userId).toBe('u-1');
      expect(arg.email).toBe('a@test.com');
      expect(arg.userAgent).toBe('agent');
      // The persisted hash must NOT be the plaintext token.
      expect(arg.tokenHash).not.toBe(token);
      expect(arg.tokenHash).toMatch(/^[a-f0-9]{64}$/); // sha256 hex
      expect(typeof arg.familyId).toBe('string');
    });
  });

  describe('rotate', () => {
    it('rotates a valid token within the same family and revokes the old one', async () => {
      storage.findByHash.mockResolvedValue(activeRow());
      const result = await service.rotate('rtok_old', 'agent');

      expect(result.userId).toBe('u-1');
      expect(result.email).toBe('a@test.com');
      expect(result.refreshToken.startsWith('rtok_')).toBe(true);
      expect(result.refreshToken).not.toBe('rtok_old');

      // New token created in the SAME family.
      const created = storage.create.mock.calls[0][0];
      expect(created.familyId).toBe('fam-1');
      // Old token revoked, linked to its successor.
      expect(storage.revoke).toHaveBeenCalledWith('t-old', 't-new');
      expect(storage.revokeFamily).not.toHaveBeenCalled();
    });

    it('throws on a missing token', async () => {
      await expect(service.rotate('')).rejects.toThrow(UnauthorizedException);
      expect(storage.findByHash).not.toHaveBeenCalled();
    });

    it('throws on an unknown token', async () => {
      storage.findByHash.mockResolvedValue(null);
      await expect(service.rotate('rtok_nope')).rejects.toThrow(UnauthorizedException);
    });

    it('detects reuse: a revoked token revokes the whole family', async () => {
      storage.findByHash.mockResolvedValue(activeRow({ revokedAt: new Date().toISOString() }));
      await expect(service.rotate('rtok_reused')).rejects.toThrow(/already used/);
      expect(storage.revokeFamily).toHaveBeenCalledWith('fam-1');
      expect(storage.create).not.toHaveBeenCalled();
    });

    it('throws on an expired token', async () => {
      storage.findByHash.mockResolvedValue(activeRow({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
      await expect(service.rotate('rtok_expired')).rejects.toThrow(/expired/);
      expect(storage.create).not.toHaveBeenCalled();
    });
  });

  describe('revoke / revokeAllForUser', () => {
    it('revokes an active presented token', async () => {
      storage.findByHash.mockResolvedValue(activeRow());
      await service.revoke('rtok_bye');
      expect(storage.revoke).toHaveBeenCalledWith('t-old');
    });

    it('is a no-op for an unknown or empty token', async () => {
      storage.findByHash.mockResolvedValue(null);
      await service.revoke('rtok_unknown');
      await service.revoke('');
      expect(storage.revoke).not.toHaveBeenCalled();
    });

    it('does not double-revoke an already-revoked token', async () => {
      storage.findByHash.mockResolvedValue(activeRow({ revokedAt: new Date().toISOString() }));
      await service.revoke('rtok_already');
      expect(storage.revoke).not.toHaveBeenCalled();
    });

    it('delegates revokeAllForUser to storage', async () => {
      await service.revokeAllForUser('u-1');
      expect(storage.revokeAllForUser).toHaveBeenCalledWith('u-1');
    });

    it('ignores revokeAllForUser with no userId', async () => {
      await service.revokeAllForUser('');
      expect(storage.revokeAllForUser).not.toHaveBeenCalled();
    });
  });
});
