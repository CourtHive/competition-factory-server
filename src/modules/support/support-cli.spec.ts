import { run } from '../../scripts/support-reports.mjs';

const reference = 'cb405e2b-9829-4538-b934-079bc4ea197a';

describe('super-admin support CLI', () => {
  it('sends a written file using an environment session and refuses remote HTTP/redirects', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reference }) });
    const output = vi.fn();
    await run(['resolve', reference, '-'], {
      env: { SUPPORT_CFS_URL: 'https://cfs.example.test', SUPPORT_ADMIN_TOKEN: 'test-session' },
      request,
      read: vi.fn().mockResolvedValue('Written resolution'),
      output,
    });
    const [url, options] = request.mock.calls[0];
    expect(String(url)).toBe(`https://cfs.example.test/admin/support/reports/${reference}/resolution`);
    expect(options.redirect).toBe('error');
    expect(options.headers.Authorization).toBe('Bearer test-session');
    expect(JSON.parse(options.body)).toEqual({ resolution: 'Written resolution' });
    expect(output.mock.calls.flat().join('')).not.toContain('test-session');
    await expect(
      run(['list'], {
        env: { SUPPORT_CFS_URL: 'http://remote.example.test', SUPPORT_ADMIN_TOKEN: 'test-session' },
        request,
      }),
    ).rejects.toThrow('HTTPS');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('filters the inbox by scope and kind, and refuses unknown or misplaced filters before any request', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reports: [] }) });
    const env = { SUPPORT_CFS_URL: 'https://cfs.example.test', SUPPORT_ADMIN_TOKEN: 'test-session' };
    await run(['list', '50', '--kind=suggestion', '--scope=platform'], { env, request, output: vi.fn() });
    const url = new URL(String(request.mock.calls[0][0]));
    expect(url.pathname).toBe('/admin/support/reports');
    expect(Object.fromEntries(url.searchParams)).toEqual({ offset: '50', kind: 'suggestion', scope: 'platform' });
    await expect(run(['list', '--kind=praise'], { env, request })).rejects.toThrow('Unknown kind');
    await expect(run(['show', reference, '--scope=platform'], { env, request })).rejects.toThrow('list only');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
