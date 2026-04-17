import { SsoTokenService } from './sso-token.service';

describe('SsoTokenService', () => {
  let service: SsoTokenService;
  let mockClient: any;

  beforeEach(() => {
    mockClient = {
      set: jest.fn().mockResolvedValue('OK'),
      getDel: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      isOpen: true,
    };

    service = new SsoTokenService();
    // Inject mock client directly (bypass onModuleInit)
    (service as any).client = mockClient;
  });

  describe('generate', () => {
    it('stores token in Redis with 60s TTL and returns token + expiresIn', async () => {
      let result: any = await service.generate({
        externalId: 'ext-123',
        ssoProvider: 'ioncourt',
        providerId: 'prov-a',
        provisionerId: 'prov-1',
      });

      expect(result.token).toBeDefined();
      expect(result.token).toHaveLength(36); // UUID format
      expect(result.expiresIn).toBe(60);

      expect(mockClient.set).toHaveBeenCalledWith(
        expect.stringContaining('sso:token:'),
        expect.stringContaining('"externalId":"ext-123"'),
        { EX: 60 },
      );
    });

    it('throws when Redis is not available', async () => {
      (service as any).client = null;
      await expect(service.generate({
        externalId: 'ext-123',
        ssoProvider: 'ioncourt',
        providerId: 'prov-a',
        provisionerId: 'prov-1',
      })).rejects.toThrow('Redis not available');
    });
  });

  describe('consume', () => {
    it('returns payload and atomically deletes token', async () => {
      const payload = { externalId: 'ext-123', ssoProvider: 'ioncourt', providerId: 'prov-a', provisionerId: 'prov-1' };
      mockClient.getDel.mockResolvedValueOnce(JSON.stringify(payload));

      let result: any = await service.consume('some-token-uuid');

      expect(result).toEqual(payload);
      expect(mockClient.getDel).toHaveBeenCalledWith('sso:token:some-token-uuid');
    });

    it('returns null for expired/consumed token', async () => {
      mockClient.getDel.mockResolvedValueOnce(null);

      let result: any = await service.consume('expired-token');
      expect(result).toBeNull();
    });

    it('returns null for corrupt payload', async () => {
      mockClient.getDel.mockResolvedValueOnce('not-json{{{');

      let result: any = await service.consume('corrupt-token');
      expect(result).toBeNull();
    });

    it('throws when Redis is not available', async () => {
      (service as any).client = null;
      await expect(service.consume('token')).rejects.toThrow('Redis not available');
    });
  });
});
