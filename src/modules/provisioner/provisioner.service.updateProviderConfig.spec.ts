import { ProvisionerService } from './provisioner.service';

// `updateProviderConfig` must write only the keys it was given, in one storage call. Rewriting the
// whole stored record would put back a stale copy of keys other routes own (teamColors, settings).

function makeService(patchResult = { success: true }) {
  const storage = {
    getProvider: vi.fn(),
    setProvider: vi.fn(),
    patchProvider: vi.fn().mockResolvedValue(patchResult),
  };
  const noop = {} as any;
  const service = new ProvisionerService(noop, noop, noop, storage as any, noop, noop, noop, noop, noop, noop, noop);
  return { service, storage };
}

describe('ProvisionerService.updateProviderConfig', () => {
  it('patches only the supplied keys and maps legacy providerConfig to caps', async () => {
    const { service, storage } = makeService();
    const result = await service.updateProviderConfig('p1', { providerConfig: { a: 1 }, inactive: true });
    expect(result).toEqual({ success: true });
    expect(storage.patchProvider).toHaveBeenCalledWith('p1', { providerConfigCaps: { a: 1 }, inactive: true });
    expect(storage.getProvider).not.toHaveBeenCalled();
    expect(storage.setProvider).not.toHaveBeenCalled();
  });

  it('keeps the PROVIDER_NOT_FOUND answer when no row matches', async () => {
    const { service } = makeService({ success: false });
    expect(await service.updateProviderConfig('missing', { organisationName: 'X' })).toEqual({
      error: 'Provider not found',
      code: 'PROVIDER_NOT_FOUND',
    });
  });
});
