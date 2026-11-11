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

  describe('getRecordById', () => {
    it('reads the record by its own id with the service token', async () => {
      process.env.AMS_BASE_URL = 'http://localhost:3130';
      process.env.AMS_SERVICE_TOKEN = 'tok-1';
      const record = { sanctioningId: 'sanc-1', status: 'APPROVED', proposal: {} };
      const fetchSpy = vi
        .spyOn(global as any, 'fetch')
        .mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify(record) });
      expect(await new SanctioningClient().getRecordById('sanc-1')).toEqual(record);
      expect(fetchSpy).toHaveBeenCalledWith('http://localhost:3130/sanctioning/record-by-id/sanc-1', {
        headers: { 'x-service-token': 'tok-1' },
      });
    });

    it('returns null for an empty body (AMS has no such record) and on 404', async () => {
      process.env.AMS_BASE_URL = 'http://localhost:3130';
      vi.spyOn(global as any, 'fetch').mockResolvedValueOnce({ ok: true, status: 200, text: async () => '' });
      expect(await new SanctioningClient().getRecordById('sanc-1')).toBeNull();
      vi.spyOn(global as any, 'fetch').mockResolvedValueOnce({ ok: false, status: 404 });
      expect(await new SanctioningClient().getRecordById('sanc-1')).toBeNull();
    });
  });

  describe('markActivated', () => {
    it('posts the stored tournament to AMS with the service token', async () => {
      process.env.AMS_BASE_URL = 'http://localhost:3130';
      process.env.AMS_SERVICE_TOKEN = 'tok-1';
      const fetchSpy = vi
        .spyOn(global as any, 'fetch')
        .mockResolvedValue({ ok: true, status: 201, text: async () => '' });
      await new SanctioningClient().markActivated('sanc-1', 't-1');
      expect(fetchSpy).toHaveBeenCalledWith('http://localhost:3130/sanctioning/records/sanc-1/activated', {
        method: 'POST',
        headers: { 'x-service-token': 'tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ tournamentId: 't-1' }),
      });
    });

    it("throws with AMS's answer when AMS refuses", async () => {
      process.env.AMS_BASE_URL = 'http://localhost:3130';
      vi.spyOn(global as any, 'fetch').mockResolvedValue({ ok: false, status: 400, text: async () => 'not APPROVED' });
      await expect(new SanctioningClient().markActivated('sanc-1', 't-1')).rejects.toThrow(/HTTP 400 not APPROVED/);
    });

    it('does nothing when the client is disabled', async () => {
      process.env.AMS_BASE_URL = 'disabled';
      const fetchSpy = vi.spyOn(global as any, 'fetch');
      await new SanctioningClient().markActivated('sanc-1', 't-1');
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
