import { NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';

import { ProviderApiKeyService } from './provider-api-key.service';

describe('ProviderApiKeyService', () => {
  let apiKeyStorage: any;
  let providerStorage: any;
  let auditService: any;
  let service: ProviderApiKeyService;

  beforeEach(() => {
    apiKeyStorage = {
      create: jest.fn(),
      listByProvider: jest.fn(),
      revoke: jest.fn(),
    };
    providerStorage = {
      getProvider: jest.fn(),
    };
    auditService = {
      recordMutation: jest.fn().mockResolvedValue(undefined),
    };
    service = new ProviderApiKeyService(apiKeyStorage, providerStorage, auditService);
  });

  describe('generateApiKey', () => {
    it('mints a pkey_live_<hex> key, stores only the SHA-256 hash, and returns plaintext once', async () => {
      providerStorage.getProvider.mockResolvedValueOnce({ providerId: 'kronos', organisationName: 'Kronos' });
      apiKeyStorage.create.mockImplementationOnce(async (input: any) => ({
        keyId: 'new-k', providerId: 'kronos', apiKeyHash: input.apiKeyHash, label: 'prod', isActive: true,
      }));

      const result = await service.generateApiKey('kronos', 'prod', { userId: 'u-1', userEmail: 'a@b.c' });

      expect(result.apiKey).toMatch(/^pkey_live_[0-9a-f]{64}$/);
      expect(result.keyId).toBe('new-k');
      const expectedHash = createHash('sha256').update(result.apiKey).digest('hex');
      expect(apiKeyStorage.create).toHaveBeenCalledWith({
        providerId: 'kronos',
        apiKeyHash: expectedHash,
        label: 'prod',
        isActive: true,
      });
    });

    it('throws NotFoundException when provider does not exist', async () => {
      providerStorage.getProvider.mockResolvedValueOnce(null);
      await expect(service.generateApiKey('ghost', undefined)).rejects.toThrow(NotFoundException);
      expect(apiKeyStorage.create).not.toHaveBeenCalled();
    });

    it('audits the issuance with status=applied, source=admin, and the new keyId in metadata', async () => {
      providerStorage.getProvider.mockResolvedValueOnce({ providerId: 'kronos' });
      apiKeyStorage.create.mockResolvedValueOnce({
        keyId: 'k-1', providerId: 'kronos', apiKeyHash: 'h', label: 'prod', isActive: true,
      });
      await service.generateApiKey('kronos', 'prod', { userId: 'u-1', userEmail: 'admin@x.com' });
      expect(auditService.recordMutation).toHaveBeenCalledWith(expect.objectContaining({
        tournamentIds: ['kronos'],
        userId: 'u-1',
        userEmail: 'admin@x.com',
        source: 'admin',
        methods: [{ method: 'generateProviderApiKey', params: { providerId: 'kronos', label: 'prod', keyId: 'k-1' } }],
        status: 'applied',
        metadata: { providerId: 'kronos', keyId: 'k-1', label: 'prod' },
      }));
    });

    it('does not throw when the audit hook itself fails (fail-soft)', async () => {
      providerStorage.getProvider.mockResolvedValueOnce({ providerId: 'kronos' });
      apiKeyStorage.create.mockResolvedValueOnce({ keyId: 'k-1', providerId: 'kronos', apiKeyHash: 'h' });
      auditService.recordMutation.mockRejectedValueOnce(new Error('audit DB down'));
      await expect(service.generateApiKey('kronos', undefined)).resolves.toBeTruthy();
    });
  });

  describe('listApiKeys', () => {
    it('returns key metadata without the api_key_hash field', async () => {
      apiKeyStorage.listByProvider.mockResolvedValueOnce([
        { keyId: 'k-1', providerId: 'kronos', apiKeyHash: 'secret', label: 'prod', isActive: true, createdAt: '2026-05-22' },
      ]);
      const result = await service.listApiKeys('kronos');
      expect(result.success).toBe(true);
      expect(result.keys[0]).toEqual(expect.not.objectContaining({ apiKeyHash: expect.anything() }));
      expect(result.keys[0].prefix).toBe('pkey_live_');
      expect(result.keys[0].label).toBe('prod');
    });
  });

  describe('revokeApiKey', () => {
    it('marks the key revoked and audits the action', async () => {
      apiKeyStorage.revoke.mockResolvedValueOnce({ success: true });
      const result = await service.revokeApiKey('k-1', { userId: 'u-1', userEmail: 'admin@x.com' }, 'kronos');
      expect(result.success).toBe(true);
      expect(apiKeyStorage.revoke).toHaveBeenCalledWith('k-1');
      expect(auditService.recordMutation).toHaveBeenCalledWith(expect.objectContaining({
        tournamentIds: ['kronos'],
        source: 'admin',
        methods: [{ method: 'revokeProviderApiKey', params: { keyId: 'k-1' } }],
        status: 'applied',
      }));
    });
  });
});
