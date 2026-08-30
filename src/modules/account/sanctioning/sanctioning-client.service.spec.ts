import { SanctioningClient } from './sanctioning-client.service';

describe('SanctioningClient', () => {
  const orig = {
    url: process.env.AMS_BASE_URL,
    tok: process.env.AMS_SERVICE_TOKEN,
    dis: process.env.AMS_DISABLED,
  };

  afterEach(() => {
    process.env.AMS_BASE_URL = orig.url;
    process.env.AMS_SERVICE_TOKEN = orig.tok;
    process.env.AMS_DISABLED = orig.dis;
    vi.restoreAllMocks();
  });

  it('returns null when disabled (=disabled base url)', async () => {
    process.env.AMS_BASE_URL = 'disabled';
    expect(await new SanctioningClient().getRecordByTournamentId('t-1')).toBeNull();
  });

  it('returns null for an empty tournamentId', async () => {
    process.env.AMS_BASE_URL = 'http://localhost:3130';
    expect(await new SanctioningClient().getRecordByTournamentId('')).toBeNull();
  });

  it('sends the service token and returns the record on 200', async () => {
    process.env.AMS_BASE_URL = 'http://localhost:3130';
    process.env.AMS_SERVICE_TOKEN = 'tok-1';
    const record = { sanctioningId: 'sanc-1', status: 'APPROVED', proposal: {} };
    const fetchSpy = vi
      .spyOn(global as any, 'fetch')
      .mockResolvedValue({ ok: true, status: 200, json: async () => record });
    const res = await new SanctioningClient().getRecordByTournamentId('t-1');
    expect(res).toEqual(record);
    expect(fetchSpy).toHaveBeenCalledWith('http://localhost:3130/sanctioning/record-by-tournament/t-1', {
      headers: { 'x-service-token': 'tok-1' },
    });
  });

  it('returns null on 404', async () => {
    process.env.AMS_BASE_URL = 'http://localhost:3130';
    vi.spyOn(global as any, 'fetch').mockResolvedValue({ ok: false, status: 404 });
    expect(await new SanctioningClient().getRecordByTournamentId('t-1')).toBeNull();
  });

  it('throws on other non-ok status', async () => {
    process.env.AMS_BASE_URL = 'http://localhost:3130';
    vi.spyOn(global as any, 'fetch').mockResolvedValue({ ok: false, status: 500 });
    await expect(new SanctioningClient().getRecordByTournamentId('t-1')).rejects.toThrow(/HTTP 500/);
  });
});
