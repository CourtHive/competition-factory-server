import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { io, Socket } from 'socket.io-client';
import { mocksEngine } from 'tods-competition-factory';
import request from 'supertest';

import { AppModule } from '../../modules/app/app.module';
import { TEST_EMAIL, TEST_PASSWORD } from '../../common/constants/test';

jest.setTimeout(120_000);

const CONCURRENCY = 10;
const TOURNAMENT_A = 'mutex-stress-a';
const TOURNAMENT_B = 'mutex-stress-b';
const ACK_TIMEOUT_MS = 40_000;

function connectSocket(port: number, token: string): Socket {
  return io(`http://localhost:${port}/tmx`, {
    extraHeaders: { authorization: `Bearer ${token}` },
    transports: ['websocket'],
    forceNew: true,
  });
}

function sendExecutionQueue(
  socket: Socket,
  payload: Record<string, any>,
  timeoutMs = ACK_TIMEOUT_MS,
): Promise<Record<string, any>> {
  const ackId = randomUUID();
  const fullPayload = { ...payload, ackId };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('ack', handler);
      reject(new Error(`Ack timeout after ${timeoutMs}ms (ackId: ${ackId})`));
    }, timeoutMs);

    function handler(response: any) {
      if (response?.ackId === ackId) {
        clearTimeout(timer);
        socket.off('ack', handler);
        resolve(response);
      }
    }

    socket.on('ack', handler);
    socket.emit('executionQueue', { type: 'executionQueue', payload: fullPayload });
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

describe('Mutex Stress Test — E2E WebSocket', () => {
  let app: INestApplication;
  let token: string;
  let port: number;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);

    const server = app.getHttpServer();
    const address = server.address();
    port = typeof address === 'string' ? parseInt(address, 10) : address.port;

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
      await request(server)
        .post('/factory/remove')
        .set('Authorization', `Bearer ${token}`)
        .send({ tournamentId });

      const { tournamentRecord } = mocksEngine.generateTournamentRecord({
        tournamentAttributes: { tournamentId },
      });
      tournamentRecord.parentOrganisation = { organisationId: 'mutex-stress-org' };

      const saveRes = await request(server)
        .post('/factory/save')
        .set('Authorization', `Bearer ${token}`)
        .send({ tournamentRecord })
        .expect(200);
      expect(saveRes.body.success).toEqual(true);
    }
  });

  afterAll(async () => {
    // Disconnect all sockets and wait for transport close
    for (const s of sockets) {
      s.removeAllListeners();
      if (s.connected) s.disconnect();
      s.close();
    }

    // Remove test tournaments
    const server = app.getHttpServer();
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

  function createSocket(): Socket {
    const s = connectSocket(port, token);
    sockets.push(s);
    return s;
  }

  async function waitForConnect(socket: Socket): Promise<void> {
    if (socket.connected) return;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Socket connect timeout')), 10_000);
      socket.on('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.on('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  it('serializes 10 concurrent requests to the same tournament', async () => {
    const promises: Promise<Record<string, any>>[] = [];

    for (let i = 0; i < CONCURRENCY; i++) {
      const s = createSocket();
      await waitForConnect(s);
      promises.push(sendExecutionQueue(s, makeDatesMutation(TOURNAMENT_A)));
    }

    const results = await Promise.all(promises);
    for (const r of results) {
      expect(r.success).toBeDefined();
      expect(r.error).toBeUndefined();
    }
    expect(results).toHaveLength(CONCURRENCY);
  });

  it('allows concurrent requests to different tournaments', async () => {
    const s1 = createSocket();
    const s2 = createSocket();
    await Promise.all([waitForConnect(s1), waitForConnect(s2)]);

    const [r1, r2] = await Promise.all([
      sendExecutionQueue(s1, makeDatesMutation(TOURNAMENT_A)),
      sendExecutionQueue(s2, makeDatesMutation(TOURNAMENT_B)),
    ]);

    expect(r1.success).toBeDefined();
    expect(r1.error).toBeUndefined();
    expect(r2.success).toBeDefined();
    expect(r2.error).toBeUndefined();
  });

  it('returns error for nonexistent tournament without hanging', async () => {
    const s = createSocket();
    await waitForConnect(s);

    const result = await sendExecutionQueue(s, makeDatesMutation('nonexistent-tournament-xyz'));

    expect(result.error).toBeDefined();
  });

  it('handles 20-request burst to the same tournament', async () => {
    const burstSize = 20;
    const promises: Promise<Record<string, any>>[] = [];

    for (let i = 0; i < burstSize; i++) {
      const s = createSocket();
      await waitForConnect(s);
      promises.push(sendExecutionQueue(s, makeDatesMutation(TOURNAMENT_A)));
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
      const s = createSocket();
      await waitForConnect(s);
      promises.push(sendExecutionQueue(s, makeDatesMutation(tid)));
    }

    const results = await Promise.all(promises);
    for (const r of results) {
      expect(r.success).toBeDefined();
      expect(r.error).toBeUndefined();
    }
    expect(results).toHaveLength(count);
  });

  it('prevents deadlock when locking [A,B] and [B,A] concurrently', async () => {
    const s1 = createSocket();
    const s2 = createSocket();
    await Promise.all([waitForConnect(s1), waitForConnect(s2)]);

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

    const [r1, r2] = await Promise.all([
      sendExecutionQueue(s1, payloadAB),
      sendExecutionQueue(s2, payloadBA),
    ]);

    expect(r1.success).toBeDefined();
    expect(r1.error).toBeUndefined();
    expect(r2.success).toBeDefined();
    expect(r2.error).toBeUndefined();
  });
});
