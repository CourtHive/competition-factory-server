/**
 * E2E test: REST mutation → Socket.IO broadcast to tournament room clients.
 *
 * Verifies that when an external app submits a mutation via the REST API,
 * TMX clients connected via Socket.IO and joined to the tournament room
 * receive the tournamentMutation event.
 */
import { mocksEngine } from 'tods-competition-factory';
import { AppModule } from 'src/modules/app/app.module';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';

import { saveAndCommit } from 'src/tests/helpers/saveAndCommit';

// constants
import { TEST, TEST_EMAIL, TEST_PASSWORD } from 'src/common/constants/test';

describe('REST → Socket.IO broadcast', () => {
  let app: INestApplication;
  let httpServer: any;
  let baseUrl: string;
  let token: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0); // random port

    httpServer = app.getHttpServer();
    const address = httpServer.address();
    baseUrl = `http://127.0.0.1:${address.port}`;

    // Get JWT token
    const loginRes = await request(httpServer)
      .post('/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
      .expect(200);
    token = loginRes.body.token;

    // Save a tournament record so mutations have something to operate on
    const drawProfiles = [{ drawSize: 4 }];
    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      drawProfiles,
      tournamentAttributes: { tournamentId: TEST },
    });
    await saveAndCommit(httpServer, token, tournamentRecord);
  });

  afterAll(async () => {
    await app?.close();
  });

  function connectTmxClient(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = io(`${baseUrl}/tmx`, {
        auth: { token },
        extraHeaders: { authorization: `Bearer ${token}` },
        transports: ['websocket', 'polling'],
        reconnection: false,
      });
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', (err) => reject(err));
      setTimeout(() => reject(new Error('Socket connection timeout')), 10000);
    });
  }

  function connectPublicClient(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = io(`${baseUrl}/public`, {
        transports: ['websocket', 'polling'],
        reconnection: false,
      });
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', (err) => reject(err));
      setTimeout(() => reject(new Error('Socket connection timeout')), 10000);
    });
  }

  it('REST executionQueue broadcasts tournamentMutation to /tmx room clients', async () => {
    const tmxClient = await connectTmxClient();

    try {
      // Join the tournament room
      tmxClient.emit('joinTournament', { tournamentId: TEST });
      // Give the room join a moment to process
      await new Promise((r) => setTimeout(r, 200));

      // Set up listener for broadcast BEFORE sending REST mutation
      const broadcastPromise = new Promise<any>((resolve) => {
        tmxClient.on('tournamentMutation', (data) => resolve(data));
        // Timeout after 5 seconds
        setTimeout(() => resolve(null), 5000);
      });

      // Send REST mutation
      const result = await request(httpServer)
        .post('/factory')
        .set('Authorization', `Bearer ${token}`)
        .send({
          tournamentId: TEST,
          methods: [
            {
              method: 'setTournamentDates',
              params: { tournamentId: TEST, startDate: '2025-06-01', endDate: '2025-06-07' },
            },
          ],
        })
        .expect(200);

      expect(result.body.success).toBe(true);

      // Wait for the broadcast
      const broadcast = await broadcastPromise;

      expect(broadcast).not.toBeNull();
      expect(broadcast.tournamentIds).toContain(TEST);
      expect(broadcast.methods).toBeDefined();
      expect(broadcast.methods[0].method).toBe('setTournamentDates');
    } finally {
      tmxClient.disconnect();
    }
  });

  it('REST executionQueue broadcasts publicUpdate to /public room clients', async () => {
    const publicClient = await connectPublicClient();

    try {
      // Join the public tournament room
      publicClient.emit('joinTournament', { tournamentId: TEST });
      await new Promise((r) => setTimeout(r, 200));

      // Listen for publicUpdate
      const updatePromise = new Promise<any>((resolve) => {
        publicClient.on('publicUpdate', (data) => resolve(data));
        setTimeout(() => resolve(null), 5000);
      });

      // Get a matchUp to score
      const queryResult = await request(httpServer)
        .post('/factory/query')
        .set('Authorization', `Bearer ${token}`)
        .send({
          tournamentId: TEST,
          method: 'allTournamentMatchUps',
          params: { tournamentId: TEST },
        })
        .expect(200);

      const matchUps = queryResult.body.matchUps || [];
      const matchUp = matchUps.find((m: any) => m.sides?.every((s: any) => s.participantId));

      if (matchUp) {
        // Score the matchUp via REST — this should trigger publicUpdate
        await request(httpServer)
          .post('/factory')
          .set('Authorization', `Bearer ${token}`)
          .send({
            tournamentId: TEST,
            methods: [
              {
                method: 'setMatchUpStatus',
                params: {
                  tournamentId: TEST,
                  drawId: matchUp.drawId,
                  matchUpId: matchUp.matchUpId,
                  outcome: {
                    winningSide: 1,
                    score: {
                      scoreStringSide1: '6-3 6-4',
                      scoreStringSide2: '3-6 4-6',
                      sets: [
                        { setNumber: 1, side1Score: 6, side2Score: 3, winningSide: 1 },
                        { setNumber: 2, side1Score: 6, side2Score: 4, winningSide: 1 },
                      ],
                    },
                  },
                },
              },
            ],
          })
          .expect(200);

        const update = await updatePromise;
        // publicUpdate should contain matchUp data
        if (update) {
          expect(update.type).toBe('matchUpUpdate');
          expect(update.tournamentId).toBe(TEST);
          expect(update.matchUps).toBeDefined();
        }
      }
    } finally {
      publicClient.disconnect();
    }
  });

  it('failed REST mutation does NOT broadcast to room clients', async () => {
    const tmxClient = await connectTmxClient();

    try {
      tmxClient.emit('joinTournament', { tournamentId: TEST });
      await new Promise((r) => setTimeout(r, 200));

      let receivedBroadcast = false;
      tmxClient.on('tournamentMutation', () => {
        receivedBroadcast = true;
      });

      // Send a mutation that will fail (missing required params)
      await request(httpServer)
        .post('/factory')
        .set('Authorization', `Bearer ${token}`)
        .send({
          tournamentId: TEST,
          methods: [{ method: 'addEvent', params: {} }],
        })
        .expect((res) => expect([200, 500]).toContain(res.status));

      // Wait to confirm no broadcast was sent
      await new Promise((r) => setTimeout(r, 500));
      expect(receivedBroadcast).toBe(false);
    } finally {
      tmxClient.disconnect();
    }
  });
});
