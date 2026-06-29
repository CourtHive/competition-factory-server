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

interface MockTournamentProvisionerStorage {
  getByTournament: jest.Mock;
}

function makeProviderStorage(provider: any | null = null): MockProviderStorage {
  return {
    getProvider: jest.fn().mockResolvedValue(provider),
    updateProviderSettings: jest.fn().mockResolvedValue({ success: true }),
  };
}

function makeTournamentProvisionerStorage(row: any | null = null): MockTournamentProvisionerStorage {
  return {
    getByTournament: jest.fn().mockResolvedValue(row),
  };
}

function makeService(
  providerStorage: MockProviderStorage,
  tournamentProvisionerStorage: MockTournamentProvisionerStorage = makeTournamentProvisionerStorage(),
): ProvidersService {
  // Other deps aren't used by the methods under test — pass minimal mocks.
  return new ProvidersService(
    providerStorage as any,
    {} as any,
    {} as any,
    tournamentProvisionerStorage as any,
    {} as any,
  );
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

  describe('getPublicBrandingByTournament', () => {
    it('returns undefined branding when tournament has no provider mapping', async () => {
      const svc = makeService(makeProviderStorage(null), makeTournamentProvisionerStorage(null));
      const result: any = await svc.getPublicBrandingByTournament('t-orphan');
      expect(result.success).toBe(true);
      expect(result.branding).toBeUndefined();
    });

    it('returns undefined branding when the mapped provider was deleted', async () => {
      const svc = makeService(
        makeProviderStorage(null), // provider lookup misses
        makeTournamentProvisionerStorage({ tournamentId: 't-1', providerId: 'p-gone' }),
      );
      const result: any = await svc.getPublicBrandingByTournament('t-1');
      expect(result.success).toBe(true);
      expect(result.branding).toBeUndefined();
    });

    it('returns the branding slice when provider has caps.branding', async () => {
      const svc = makeService(
        makeProviderStorage({
          providerConfigCaps: {
            branding: {
              appName: 'Acme Tennis',
              accentColor: '#1a5276',
              themeTokens: { '--tmx-accent-blue': '#1a5276' },
              stylesheetUrl: 'https://acme.example.com/theme.css',
            },
            permissions: { canCreateOfficials: false }, // must NOT leak
          },
          providerConfigSettings: {
            participantPrivacy: { cityState: true }, // must NOT leak
          },
        }),
        makeTournamentProvisionerStorage({ tournamentId: 't-1', providerId: 'p-1' }),
      );
      const result: any = await svc.getPublicBrandingByTournament('t-1');
      expect(result.success).toBe(true);
      expect(result.branding?.appName).toBe('Acme Tennis');
      expect(result.branding?.accentColor).toBe('#1a5276');
      expect(result.branding?.themeTokens).toEqual({ '--tmx-accent-blue': '#1a5276' });
      expect(result.branding?.stylesheetUrl).toBe('https://acme.example.com/theme.css');
      // Permissions and participantPrivacy must not appear on the response
      expect((result as any).permissions).toBeUndefined();
      expect((result as any).participantPrivacy).toBeUndefined();
      expect((result as any).effective).toBeUndefined();
    });

    it('returns undefined branding when provider has no branding configured', async () => {
      const svc = makeService(
        makeProviderStorage({
          providerConfigCaps: { permissions: { canCreateEvents: true } },
        }),
        makeTournamentProvisionerStorage({ tournamentId: 't-1', providerId: 'p-1' }),
      );
      const result: any = await svc.getPublicBrandingByTournament('t-1');
      expect(result.success).toBe(true);
      expect(result.branding).toBeUndefined();
    });
  });

  describe('getPublicScoringLaunchByTournament', () => {
    it('defaults to EPIXODIC when tournament has no provider mapping', async () => {
      const svc = makeService(makeProviderStorage(null), makeTournamentProvisionerStorage(null));
      const result: any = await svc.getPublicScoringLaunchByTournament('t-orphan');
      expect(result.success).toBe(true);
      expect(result.scoringLaunch).toEqual({ app: 'EPIXODIC' });
    });

    it('defaults to EPIXODIC when the mapped provider was deleted', async () => {
      const svc = makeService(
        makeProviderStorage(null),
        makeTournamentProvisionerStorage({ tournamentId: 't-1', providerId: 'p-gone' }),
      );
      const result: any = await svc.getPublicScoringLaunchByTournament('t-1');
      expect(result.scoringLaunch).toEqual({ app: 'EPIXODIC' });
    });

    it('defaults to EPIXODIC when the provider declared no scoringLaunch', async () => {
      const svc = makeService(
        makeProviderStorage({ providerConfigCaps: { permissions: { canCreateEvents: true } } }),
        makeTournamentProvisionerStorage({ tournamentId: 't-1', providerId: 'p-1' }),
      );
      const result: any = await svc.getPublicScoringLaunchByTournament('t-1');
      expect(result.scoringLaunch).toEqual({ app: 'EPIXODIC' });
    });

    it('returns the declared EXTERNAL scoringLaunch (IONSport) and leaks nothing else', async () => {
      const svc = makeService(
        makeProviderStorage({
          providerConfigCaps: {
            integrations: { scoringLaunch: { app: 'EXTERNAL', urlTemplate: 'https://ionsport.app/m/${matchUpId}' } },
            permissions: { canCreateOfficials: false }, // must NOT leak
          },
          providerConfigSettings: { participantPrivacy: { cityState: true } }, // must NOT leak
        }),
        makeTournamentProvisionerStorage({ tournamentId: 't-1', providerId: 'p-1' }),
      );
      const result: any = await svc.getPublicScoringLaunchByTournament('t-1');
      expect(result.success).toBe(true);
      expect(result.scoringLaunch).toEqual({ app: 'EXTERNAL', urlTemplate: 'https://ionsport.app/m/${matchUpId}' });
      expect((result as any).permissions).toBeUndefined();
      expect((result as any).participantPrivacy).toBeUndefined();
      expect((result as any).branding).toBeUndefined();
      expect((result as any).effective).toBeUndefined();
    });
  });
});
