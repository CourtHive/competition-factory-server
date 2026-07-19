import { DeclarationsClient } from './declarations-client.service';

function jsonResponse(body: unknown, ok = true, status = 200): any {
  return { ok, status, json: async () => body };
}

describe('DeclarationsClient registrations', () => {
  const OLD_ENV = process.env;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env = { ...OLD_ENV, DECLARATIONS_BASE_URL: 'http://declarations.test', DECLARATIONS_SERVICE_TOKEN: 'svc-token', DECLARATIONS_DISABLED: 'false' };
    fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.restoreAllMocks();
  });

  it('lists registrations for a tournament scoped to its provider, with the service token', async () => {
    const rows = [{ personId: 'p1', providerId: 'BOBOCA', tournamentId: 't1', status: 'SUBMITTED', payload: { eventIds: ['e1'] }, updatedAt: 't' }];
    fetchMock.mockResolvedValue(jsonResponse(rows));
    const client = new DeclarationsClient();

    const result = await client.listRegistrations('t1', 'BOBOCA');

    expect(result).toEqual(rows);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://declarations.test/registrations?provider=BOBOCA&tournamentId=t1');
    expect(init.headers['x-service-token']).toBe('svc-token');
  });

  it('posts a transition by declaration id', async () => {
    const row = { personId: 'p1', providerId: 'BOBOCA', tournamentId: 't1', status: 'ACCEPTED', payload: {}, updatedAt: 't' };
    fetchMock.mockResolvedValue(jsonResponse(row));
    const client = new DeclarationsClient();

    const result = await client.transitionRegistration({ declarationId: 'd1', toStatus: 'ACCEPTED', transitionedBy: 'td-1', reason: 'ok' });

    expect(result).toEqual(row);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://declarations.test/registrations/d1/transition');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ toStatus: 'ACCEPTED', transitionedBy: 'td-1', reason: 'ok' });
  });

  it('gets a single registration by id (200) and returns null on 404', async () => {
    const row = { personId: 'p1', providerId: 'BOBOCA', tournamentId: 't1', status: 'SUBMITTED', payload: { eventIds: ['e1'], applicant: { givenName: 'Jane', familyName: 'Doe' } }, updatedAt: 't' };
    fetchMock.mockResolvedValueOnce(jsonResponse(row));
    const client = new DeclarationsClient();
    expect(await client.getRegistration('d1')).toEqual(row);
    expect(fetchMock.mock.calls[0][0]).toBe('http://declarations.test/registrations/d1');

    fetchMock.mockResolvedValueOnce(jsonResponse(null, false, 404));
    expect(await client.getRegistration('missing')).toBeNull();
  });

  it('throws on a non-ok list response', async () => {
    fetchMock.mockResolvedValue(jsonResponse(null, false, 500));
    const client = new DeclarationsClient();
    await expect(client.listRegistrations('t1', 'BOBOCA')).rejects.toThrow(/HTTP 500/);
  });

  it('short-circuits when disabled (no fetch)', async () => {
    process.env.DECLARATIONS_DISABLED = 'true';
    const client = new DeclarationsClient();
    expect(await client.listRegistrations('t1', 'BOBOCA')).toEqual([]);
    expect(await client.transitionRegistration({ declarationId: 'd1', toStatus: 'REJECTED', transitionedBy: 'td-1' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
