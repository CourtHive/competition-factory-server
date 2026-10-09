import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { mocksEngine } from 'tods-competition-factory';
import request from 'supertest';

import { AppModule } from '../../modules/app/app.module';
import { saveAndCommit } from '../helpers/saveAndCommit';
import { TEST_EMAIL, TEST_PASSWORD } from '../../common/constants/test';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const CONCURRENCY = 10;
const TOURNAMENT_A = 'mutex-stress-a';
const TOURNAMENT_B = 'mutex-stress-b';
const ACK_TIMEOUT_MS = 40_000;

/**
 * Commands are `POST /factory` (the socket executionQueue was retired 2026-10-09). Concurrent
 * requests race into the same per-tournament lock the socket clients used to, so the lock is what
 * these tests exercise; the transport only delivers the requests at once.
 */
function sendExecutionQueue(
  server: any,
  token: string,
  payload: Record<string, any>,
  timeoutMs = ACK_TIMEOUT_MS,
): Promise<Record<string, any>> {
  return request(server)
    .post('/factory')
    .set('Authorization', `Bearer ${token}`)
    .timeout(timeoutMs)
    .send({ ...payload, ackId: randomUUID() })
    .then((res) => {
      // A refusal is a non-2xx response whose body IS the error (checkEngineError's
      // { message, code, ... }, or the mutation gate's 403), as TMX's toCommandOutcome reads it.
      const ok = res.status >= 200 && res.status < 300;
      return ok ? res.body : { ...res.body, error: res.body?.error ?? res.body };
    });
}

function makeDatesMutation(tournamentId: string) {
  return {
    tournamentId,
    tournamentIds: [tournamentId],
    methods: [
      {
        method: 'setTournamentDates',
        params: {
          startDate: '2025-01-01',
          endDate: '2025-01-07',
        },
      },
    ],
  };
}

describe('Mutex Stress Test — E2E HTTP', () => {
  let app: INestApplication;
  let token: string;
  let server: any;
  const send = (payload: Record<string, any>) => sendExecutionQueue(server, token, payload);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);

    server = app.getHttpServer();

    // Authenticate
    const loginRes = await request(server)
      .post('/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
      .expect(200);

    token = loginRes.body.token;
    expect(token).toBeDefined();

    // Create and save test tournaments
    for (const tournamentId of [TOURNAMENT_A, TOURNAMENT_B]) {
      // Remove any leftover from previous runs
      await request(server).post('/factory/remove').set('Authorization', `Bearer ${token}`).send({ tournamentId });

      const { tournamentRecord } = mocksEngine.generateTournamentRecord({
        tournamentAttributes: { tournamentId },
      });
      tournamentRecord.parentOrganisation = { organisationId: 'mutex-stress-org' };

      await saveAndCommit(server, token, tournamentRecord);
    }
  });

  afterAll(async () => {
    // Remove test tournaments
    await request(server)
      .post('/factory/remove')
      .set('Authorization', `Bearer ${token}`)
      .send({ tournamentId: TOURNAMENT_A });
    await request(server)
      .post('/factory/remove')
      .set('Authorization', `Bearer ${token}`)
      .send({ tournamentId: TOURNAMENT_B });

    await app.close();
  });

  it('serializes 10 concurrent requests to the same tournament', async () => {
    const promises: Promise<Record<string, any>>[] = [];

    for (let i = 0; i < CONCURRENCY; i++) {
      promises.push(send(makeDatesMutation(TOURNAMENT_A)));
    }

    const results = await Promise.all(promises);
    for (const r of results) {
      expect(r.success).toBeDefined();
      expect(r.error).toBeUndefined();
    }
    expect(results).toHaveLength(CONCURRENCY);
  });

  it('allows concurrent requests to different tournaments', async () => {
    const [r1, r2] = await Promise.all([send(makeDatesMutation(TOURNAMENT_A)), send(makeDatesMutation(TOURNAMENT_B))]);

    expect(r1.success).toBeDefined();
    expect(r1.error).toBeUndefined();
    expect(r2.success).toBeDefined();
    expect(r2.error).toBeUndefined();
  });

  it('returns error for nonexistent tournament without hanging', async () => {
    const result = await send(makeDatesMutation('nonexistent-tournament-xyz'));

    expect(result.error).toBeDefined();
  });

  it('handles 20-request burst to the same tournament', async () => {
    const burstSize = 20;
    const promises: Promise<Record<string, any>>[] = [];

    for (let i = 0; i < burstSize; i++) {
      promises.push(send(makeDatesMutation(TOURNAMENT_A)));
    }

    const results = await Promise.all(promises);
    for (const r of results) {
      expect(r.success).toBeDefined();
      expect(r.error).toBeUndefined();
    }
    expect(results).toHaveLength(burstSize);
  });

  it('handles interleaved requests across tournaments A and B', async () => {
    const count = 8;
    const promises: Promise<Record<string, any>>[] = [];

    for (let i = 0; i < count; i++) {
      const tid = i % 2 === 0 ? TOURNAMENT_A : TOURNAMENT_B;
      promises.push(send(makeDatesMutation(tid)));
    }

    const results = await Promise.all(promises);
    for (const r of results) {
      expect(r.success).toBeDefined();
      expect(r.error).toBeUndefined();
    }
    expect(results).toHaveLength(count);
  });

  it('prevents deadlock when locking [A,B] and [B,A] concurrently', async () => {
    const payloadAB = {
      tournamentIds: [TOURNAMENT_A, TOURNAMENT_B],
      methods: [
        {
          method: 'setTournamentDates',
          params: { tournamentId: TOURNAMENT_A, startDate: '2025-02-01', endDate: '2025-02-07' },
        },
        {
          method: 'setTournamentDates',
          params: { tournamentId: TOURNAMENT_B, startDate: '2025-02-01', endDate: '2025-02-07' },
        },
      ],
    };

    const payloadBA = {
      tournamentIds: [TOURNAMENT_B, TOURNAMENT_A],
      methods: [
        {
          method: 'setTournamentDates',
          params: { tournamentId: TOURNAMENT_B, startDate: '2025-03-01', endDate: '2025-03-07' },
        },
        {
          method: 'setTournamentDates',
          params: { tournamentId: TOURNAMENT_A, startDate: '2025-03-01', endDate: '2025-03-07' },
        },
      ],
    };

    const [r1, r2] = await Promise.all([send(payloadAB), send(payloadBA)]);

    expect(r1.success).toBeDefined();
    expect(r1.error).toBeUndefined();
    expect(r2.success).toBeDefined();
    expect(r2.error).toBeUndefined();
  });
});
