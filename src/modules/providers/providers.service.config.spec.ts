/**
 * Focused unit tests for the new two-tier provider-config service
 * methods on ProvidersService — `getEffectiveProviderConfig` and
 * `updateProviderSettings`. The full ProvidersService also exposes
 * calendar / addProvider / etc; those have separate coverage in
 * providers.service.spec.ts.
 *
 * These tests use mock storage (no Postgres) so they run anywhere.
 */

import { ProvidersService } from './providers.service';

interface MockProviderStorage {
  getProvider: jest.Mock;
  updateProviderSettings: jest.Mock;
}

function makeProviderStorage(provider: any | null = null): MockProviderStorage {
  return {
    getProvider: jest.fn().mockResolvedValue(provider),
    updateProviderSettings: jest.fn().mockResolvedValue({ success: true }),
  };
}

function makeService(providerStorage: MockProviderStorage): ProvidersService {
  // Other deps aren't used by the methods under test — pass minimal mocks.
  return new ProvidersService(providerStorage as any, {} as any, {} as any, {} as any);
}

describe('ProvidersService — provider config two-tier methods', () => {
  describe('getEffectiveProviderConfig', () => {
    it('returns error when provider does not exist', async () => {
      const svc = makeService(makeProviderStorage(null));
      const result: any = await svc.getEffectiveProviderConfig('p1');
      expect(result.error).toBe('Provider not found');
    });

    it('returns merged effective shape when provider exists', async () => {
      const svc = makeService(
        makeProviderStorage({
          providerConfigCaps: {
            permissions: { canCreateOfficials: true, allowedDrawTypes: ['SE', 'RR'] },
            branding: { appName: 'Acme' },
          },
          providerConfigSettings: {
            permissions: { canCreateOfficials: false, allowedDrawTypes: ['SE'] },
          },
        }),
      );
      const result: any = await svc.getEffectiveProviderConfig('p1');
      expect(result.success).toBe(true);
      expect(result.providerId).toBe('p1');
      expect(result.effective.branding?.appName).toBe('Acme');
      expect(result.effective.permissions?.canCreateOfficials).toBe(false);
      expect(result.effective.permissions?.allowedDrawTypes).toEqual(['SE']);
    });

    it('treats missing caps and settings as empty', async () => {
      const svc = makeService(makeProviderStorage({ organisationId: 'p1' }));
      const result: any = await svc.getEffectiveProviderConfig('p1');
      expect(result.success).toBe(true);
      // Default-permissive: every boolean key resolves to true except the 2 default-false
      expect(result.effective.permissions?.canCreateEvents).toBe(true);
      expect(result.effective.permissions?.canModifyCompletedScores).toBe(false);
    });
  });

  describe('updateProviderSettings', () => {
    it('returns error when provider does not exist', async () => {
      const svc = makeService(makeProviderStorage(null));
      const result: any = await svc.updateProviderSettings('p1', {});
      expect(result.error).toBe('Provider not found');
    });

    it('writes settings when valid + caps-respecting', async () => {
      const storage = makeProviderStorage({
        providerConfigCaps: { permissions: { allowedDrawTypes: ['SE', 'RR'] } },
      });
      const svc = makeService(storage);
      const result: any = await svc.updateProviderSettings('p1', {
        permissions: { allowedDrawTypes: ['SE'] },
      });
      expect(result.success).toBe(true);
      expect(storage.updateProviderSettings).toHaveBeenCalledWith('p1', {
        permissions: { allowedDrawTypes: ['SE'] },
      });
    });

    it('rejects settings that exceed caps with per-field issues', async () => {
      const storage = makeProviderStorage({
        providerConfigCaps: { permissions: { allowedDrawTypes: ['SE'] } },
      });
      const svc = makeService(storage);
      const result: any = await svc.updateProviderSettings('p1', {
        permissions: { allowedDrawTypes: ['SE', 'COMPASS'] },
      });
      expect(result.code).toBe('SETTINGS_INVALID');
      expect(result.issues?.[0]?.code).toBe('exceedsCap');
      expect(result.issues?.[0]?.disallowedValues).toEqual(['COMPASS']);
      expect(storage.updateProviderSettings).not.toHaveBeenCalled();
    });

    it('rejects malformed settings (wrong type) without writing', async () => {
      const storage = makeProviderStorage({});
      const svc = makeService(storage);
      const result: any = await svc.updateProviderSettings('p1', {
        permissions: { canCreateEvents: 'yes' as any },
      });
      expect(result.code).toBe('SETTINGS_INVALID');
      expect(result.issues?.[0]?.code).toBe('wrongType');
      expect(storage.updateProviderSettings).not.toHaveBeenCalled();
    });
  });
});
