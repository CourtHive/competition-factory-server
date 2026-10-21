import { RankingsWebhookService } from './rankings-webhook.service';

describe('RankingsWebhookService', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.useRealTimers();
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
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
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
    const fetchMock = vi.fn(async () => ({
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
    const fetchMock = vi.fn(async () => {
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
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 503, text: async () => '' } as any;
      return { ok: true, status: 202, text: async () => JSON.stringify({ ingestionRunId: 'run-2' }) } as any;
    }) as any;

    const svc = new RankingsWebhookService();
    const result = await svc.publish({ tournamentId: 'T-1' });
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
  });

  describe('X-Service-Token on rankings writes', () => {
    function recordingFetch(status = 202) {
      const calls: { url: string; headers: Record<string, string> }[] = [];
      globalThis.fetch = vi.fn(async (url: any, init: any) => {
        calls.push({ url: String(url), headers: init?.headers ?? {} });
        return { ok: status < 400, status, text: async () => '{}', json: async () => ({ tournamentIds: [] }) } as any;
      }) as any;
      return calls;
    }

    it('sends the token on ingest AND on snapshot generation when RANKINGS_SERVICE_TOKEN is set', async () => {
      process.env.RANKINGS_PIPELINE_URL = 'http://rankings.local';
      process.env.RANKINGS_SERVICE_TOKEN = 'shared-secret';
      const calls = recordingFetch();

      const svc = new RankingsWebhookService();
      await svc.publish({ tournamentId: 'T-1' });
      await svc.generateSnapshot({ asOfDate: '2026-10-20' });

      expect(calls.map((c) => c.url)).toEqual([
        'http://rankings.local/tournaments/ingest',
        'http://rankings.local/rankings/snapshots',
      ]);
      for (const call of calls) expect(call.headers['X-Service-Token']).toBe('shared-secret');
    });

    it('reads the token at call time, so a rotated secret needs no restart', async () => {
      process.env.RANKINGS_PIPELINE_URL = 'http://rankings.local';
      process.env.RANKINGS_SERVICE_TOKEN = 'old';
      const calls = recordingFetch();
      const svc = new RankingsWebhookService();

      process.env.RANKINGS_SERVICE_TOKEN = 'rotated';
      await svc.publish({ tournamentId: 'T-1' });

      expect(calls[0].headers['X-Service-Token']).toBe('rotated');
    });

    it('sends no token header when unset — the rollout ships CFS before rankings enforces', async () => {
      process.env.RANKINGS_PIPELINE_URL = 'http://rankings.local';
      delete process.env.RANKINGS_SERVICE_TOKEN;
      const calls = recordingFetch();

      await new RankingsWebhookService().publish({ tournamentId: 'T-1' });

      expect(calls[0].headers).not.toHaveProperty('X-Service-Token');
      expect(calls[0].headers['Content-Type']).toBe('application/json');
    });

    it('sends no token on the public ingested-tournaments read', async () => {
      process.env.RANKINGS_PIPELINE_URL = 'http://rankings.local';
      process.env.RANKINGS_SERVICE_TOKEN = 'shared-secret';
      const calls = recordingFetch(200);

      await new RankingsWebhookService().fetchIngestedTournamentIds('BOBOCA');

      expect(calls[0].headers).not.toHaveProperty('X-Service-Token');
    });

    it('a 401 on ingest is not retried and names the variable to fix', async () => {
      process.env.RANKINGS_PIPELINE_URL = 'http://rankings.local';
      process.env.RANKINGS_PIPELINE_RETRIES = '3';
      const calls = recordingFetch(401);

      const result = await new RankingsWebhookService().publish({ tournamentId: 'T-1' });

      expect(calls).toHaveLength(1);
      expect(result).toMatchObject({ ok: false, status: 401, attempts: 1 });
      expect(result.error).toMatch(/RANKINGS_SERVICE_TOKEN/);
    });

    it('a 401 on snapshot generation names the variable to fix', async () => {
      process.env.RANKINGS_PIPELINE_URL = 'http://rankings.local';
      recordingFetch(401);

      const result = await new RankingsWebhookService().generateSnapshot({ asOfDate: '2026-10-20' });

      expect(result).toMatchObject({ ok: false, status: 401 });
      expect(result.error).toMatch(/RANKINGS_SERVICE_TOKEN/);
    });
  });
});
