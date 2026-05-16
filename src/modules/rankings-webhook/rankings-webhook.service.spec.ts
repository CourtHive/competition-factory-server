import { RankingsWebhookService } from './rankings-webhook.service';

describe('RankingsWebhookService', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
    jest.useRealTimers();
  });

  it('returns { skipped: true } when RANKINGS_PIPELINE_URL is unset', async () => {
    delete process.env.RANKINGS_PIPELINE_URL;
    const svc = new RankingsWebhookService();
    expect(svc.isEnabled()).toBe(false);
    const result = await svc.publish({ tournamentId: 'T-1' });
    expect(result).toEqual({ skipped: true });
  });

  it('returns error when tournamentRecord lacks tournamentId', async () => {
    process.env.RANKINGS_PIPELINE_URL = 'http://rankings.local';
    const svc = new RankingsWebhookService();
    const result = await svc.publish({});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/tournamentId/);
  });

  it('POSTs to /tournaments/ingest and returns ok on 2xx', async () => {
    process.env.RANKINGS_PIPELINE_URL = 'http://rankings.local';
    let receivedBody: any;
    globalThis.fetch = jest.fn(async (url: any, init: any) => {
      expect(url).toBe('http://rankings.local/tournaments/ingest');
      receivedBody = JSON.parse(init.body);
      return {
        ok: true,
        status: 202,
        text: async () => JSON.stringify({ ingestionRunId: 'run-1', awardCount: 5 }),
      } as any;
    }) as any;

    const svc = new RankingsWebhookService();
    const result = await svc.publish({ tournamentId: 'T-1', endDate: '2026-05-15' });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(202);
    expect(result.responseBody).toEqual({ ingestionRunId: 'run-1', awardCount: 5 });
    expect(result.attempts).toBe(1);
    expect(receivedBody.tournamentRecord.tournamentId).toBe('T-1');
    expect(receivedBody.source).toBe('cfs-event');
    expect(receivedBody.sourceRef).toBe('cfs:T-1');
  });

  it('does not retry on 4xx responses', async () => {
    process.env.RANKINGS_PIPELINE_URL = 'http://rankings.local';
    const fetchMock = jest.fn(async () => ({
      ok: false,
      status: 422,
      text: async () => 'bad shape',
    })) as any;
    globalThis.fetch = fetchMock;

    const svc = new RankingsWebhookService();
    const result = await svc.publish({ tournamentId: 'T-1' });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
    expect(result.attempts).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries up to maxRetries on network failure', async () => {
    process.env.RANKINGS_PIPELINE_URL = 'http://rankings.local';
    process.env.RANKINGS_PIPELINE_RETRIES = '3';
    const fetchMock = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as any;
    globalThis.fetch = fetchMock;

    const svc = new RankingsWebhookService();
    const result = await svc.publish({ tournamentId: 'T-1' });

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(3);
    expect(result.error).toMatch(/ECONNREFUSED/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries 5xx and succeeds on the second attempt', async () => {
    process.env.RANKINGS_PIPELINE_URL = 'http://rankings.local';
    process.env.RANKINGS_PIPELINE_RETRIES = '3';
    let calls = 0;
    globalThis.fetch = jest.fn(async () => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 503, text: async () => '' } as any;
      return { ok: true, status: 202, text: async () => JSON.stringify({ ingestionRunId: 'run-2' }) } as any;
    }) as any;

    const svc = new RankingsWebhookService();
    const result = await svc.publish({ tournamentId: 'T-1' });
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
  });
});
