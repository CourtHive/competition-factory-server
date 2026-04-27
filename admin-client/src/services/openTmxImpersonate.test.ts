import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('services/notifications/tmxToast', () => ({ tmxToast: vi.fn() }));
vi.mock('i18n', () => ({ t: (key: string) => key }));
vi.mock('./apis/baseApi', () => ({ baseApi: { get: vi.fn() } }));

import { openTmxImpersonate } from './openTmxImpersonate';
import { __resetRuntimeConfigForTests } from './runtimeConfig';
import { tmxToast } from 'services/notifications/tmxToast';
import { baseApi } from './apis/baseApi';

const mockToast = tmxToast as unknown as ReturnType<typeof vi.fn>;
const mockBaseApiGet = baseApi.get as unknown as ReturnType<typeof vi.fn>;

describe('openTmxImpersonate', () => {
  let openSpy: ReturnType<typeof vi.spyOn>;
  let setItemSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetRuntimeConfigForTests();
    mockToast.mockReset();
    mockBaseApiGet.mockReset();
    openSpy = vi.spyOn(globalThis, 'open').mockImplementation(() => null);
    setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => undefined);
  });

  afterEach(() => {
    openSpy.mockRestore();
    setItemSpy.mockRestore();
  });

  it('writes localStorage and opens TMX at the runtime-configured URL', async () => {
    mockBaseApiGet.mockResolvedValueOnce({ data: { tmxUrl: 'https://example.com/tmx/' } });

    await openTmxImpersonate({
      organisationId: 'p1',
      organisationName: 'One',
      organisationAbbreviation: 'ONE',
    });

    expect(setItemSpy).toHaveBeenCalledWith(
      'tmx_impersonated_provider',
      expect.stringContaining('"organisationId":"p1"'),
    );
    expect(openSpy).toHaveBeenCalledWith('https://example.com/tmx/#/tournaments', '_blank');
  });

  it('normalizes trailing slashes on the configured URL', async () => {
    mockBaseApiGet.mockResolvedValueOnce({ data: { tmxUrl: '/tmx///' } });

    await openTmxImpersonate({ organisationId: 'p1' });

    expect(openSpy).toHaveBeenCalledWith('/tmx/#/tournaments', '_blank');
  });

  it('aborts with a toast when the runtime config is unreachable', async () => {
    mockBaseApiGet.mockResolvedValueOnce(null);

    await openTmxImpersonate({ organisationId: 'p1' });

    expect(mockToast).toHaveBeenCalledWith({
      message: 'system.tmxUrlMissing',
      intent: 'is-danger',
    });
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('aborts with a toast when /api/config returns no tmxUrl', async () => {
    mockBaseApiGet.mockResolvedValueOnce({ data: {} });

    await openTmxImpersonate({ organisationId: 'p1' });

    expect(mockToast).toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('reuses the cached config across calls — only one server fetch', async () => {
    mockBaseApiGet.mockResolvedValueOnce({ data: { tmxUrl: '/tmx/' } });

    await openTmxImpersonate({ organisationId: 'p1' });
    await openTmxImpersonate({ organisationId: 'p2' });

    expect(mockBaseApiGet).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledTimes(2);
  });
});
