/**
 * Locks the contract that provider caps writes through
 * `ProvisionerService.updateProviderCaps` consult the canonical
 * `validateCaps` from `@courthive/provider-config` and reject caps
 * whose `branding.themeTokens` keys fall outside the allowed
 * `--tmx-` / `--chc-` prefix set.
 *
 * Regression guard: if someone removes the validation call, or the
 * validator stops applying to themeTokens, this spec turns red.
 *
 * The themeTokens validator itself has direct coverage in
 * `provider-config/src/validators.test.ts`; this spec only verifies
 * the CFS-side wiring through ProvisionerService.
 */

import { ProvisionerService } from './provisioner.service';

interface MockProviderStorage {
  getProvider: jest.Mock;
  updateProviderCaps: jest.Mock;
}

function makeProviderStorage(provider: any | null = {}): MockProviderStorage {
  return {
    getProvider: jest.fn().mockResolvedValue(provider),
    updateProviderCaps: jest.fn().mockResolvedValue({ success: true }),
  };
}

function makeService(providerStorage: MockProviderStorage): ProvisionerService {
  // updateProviderCaps only touches providerStorage. Other deps are
  // mocked with empty objects — they're not exercised on this path.
  const noop = {} as any;
  return new ProvisionerService(
    noop, noop, noop,
    providerStorage as any,
    noop, noop, noop, noop, noop, noop, noop,
  );
}

describe('ProvisionerService.updateProviderCaps — themeTokens validation', () => {
  it('accepts caps with well-prefixed themeTokens and writes to storage', async () => {
    const storage = makeProviderStorage({});
    const svc = makeService(storage);

    const result: any = await svc.updateProviderCaps('p1', {
      branding: {
        appName: 'Acme',
        themeTokens: {
          '--tmx-accent-blue': '#1a5276',
          '--chc-text-primary': '#000000',
        },
        stylesheetUrl: 'https://acme.example.com/theme.css',
      },
    });

    expect(result.success).toBe(true);
    expect(storage.updateProviderCaps).toHaveBeenCalledTimes(1);
  });

  it('rejects caps with off-prefix themeTokens — does NOT write', async () => {
    const storage = makeProviderStorage({});
    const svc = makeService(storage);

    const result: any = await svc.updateProviderCaps('p1', {
      branding: {
        themeTokens: {
          '--malicious-var': 'red',
          'background': 'blue',
          '--tmx-ok': '#fff',
        },
      },
    });

    expect(result.code).toBe('CAPS_INVALID');
    expect(result.issues).toHaveLength(2);
    expect(result.issues.every((i: any) => i.code === 'unknownField')).toBe(true);
    expect(result.issues.map((i: any) => i.path).sort()).toEqual([
      'branding.themeTokens.--malicious-var',
      'branding.themeTokens.background',
    ]);
    expect(storage.updateProviderCaps).not.toHaveBeenCalled();
  });

  it('rejects non-string themeTokens values — does NOT write', async () => {
    const storage = makeProviderStorage({});
    const svc = makeService(storage);

    const result: any = await svc.updateProviderCaps('p1', {
      branding: { themeTokens: { '--tmx-accent-blue': 99 } },
    });

    expect(result.code).toBe('CAPS_INVALID');
    expect(result.issues?.[0]?.code).toBe('wrongType');
    expect(result.issues?.[0]?.path).toBe('branding.themeTokens.--tmx-accent-blue');
    expect(storage.updateProviderCaps).not.toHaveBeenCalled();
  });

  it('rejects non-string stylesheetUrl — does NOT write', async () => {
    const storage = makeProviderStorage({});
    const svc = makeService(storage);

    const result: any = await svc.updateProviderCaps('p1', {
      branding: { stylesheetUrl: 42 },
    });

    expect(result.code).toBe('CAPS_INVALID');
    expect(result.issues?.[0]?.path).toBe('branding.stylesheetUrl');
    expect(result.issues?.[0]?.code).toBe('wrongType');
    expect(storage.updateProviderCaps).not.toHaveBeenCalled();
  });
});
