import { TournamentBroadcastService } from './tournament-broadcast.service';
import { ProjectorService } from 'src/modules/projectors/projector.service';
import { RecordingRealtime } from 'src/tests/helpers/recordingRealtime';
import { topicConstants } from 'tods-competition-factory';
import type { Mock } from 'vitest';

describe('TournamentBroadcastService', () => {
  let service: TournamentBroadcastService;
  let realtime: RecordingRealtime;
  let projectorService: { projectMatchUpFinalized: Mock };

  // What the public room received, per event — the old PublicGateway.broadcast* call arguments.
  const publicUpdates = (tournamentId: string) =>
    realtime.to(`public:tournament:${tournamentId}`, 'publicUpdate').map((p) => p.payload);
  const liveScores = (tournamentId: string) =>
    realtime.to(`public:tournament:${tournamentId}`, 'liveScore').map((p) => p.payload);
  const allPublicUpdates = () => realtime.published.filter((p) => p.event === 'publicUpdate');
  const allLiveScores = () => realtime.published.filter((p) => p.event === 'liveScore');

  beforeEach(() => {
    realtime = new RecordingRealtime();
    projectorService = { projectMatchUpFinalized: vi.fn() };
    service = new TournamentBroadcastService(realtime, realtime, projectorService as unknown as ProjectorService);
  });

  describe('broadcastMutation', () => {
    const payload = {
      tournamentIds: ['tournament-123'],
      methods: [{ method: 'setMatchUpStatus', params: { matchUpId: 'm1' } }],
      userId: 'user-1',
      timestamp: Date.now(),
    };

    it('broadcasts to all clients when no sender (REST path)', async () => {
      await service.broadcastMutation(payload);

      const sent = realtime.to('tournament:tournament-123', 'tournamentMutation');
      expect(sent).toHaveLength(1);
      expect(sent[0].channel.namespace).toBe('tmx');
      expect(sent[0].payload).toEqual(
        expect.objectContaining({
          methods: payload.methods,
          tournamentIds: payload.tournamentIds,
          userId: payload.userId,
        }),
      );
      // Nobody is excluded on the REST path.
      expect(sent[0].options?.excludeConnectionId).toBeUndefined();
    });

    it('broadcasts excluding sender when sender provided (Socket.IO path)', async () => {
      await service.broadcastMutation(payload, { excludeConnectionId: 'sender-socket-id' });

      const sent = realtime.to('tournament:tournament-123', 'tournamentMutation');
      expect(sent).toHaveLength(1);
      expect(sent[0].payload).toEqual(
        expect.objectContaining({
          methods: payload.methods,
          tournamentIds: payload.tournamentIds,
        }),
      );
      // The one broadcast excludes the sender — there is no second, unexcluded emit.
      expect(sent[0].options).toEqual({ excludeConnectionId: 'sender-socket-id' });
    });

    it('skips broadcast when methods are empty', async () => {
      await service.broadcastMutation({ ...payload, methods: [] });

      expect(realtime.published).toHaveLength(0);
    });

    it('skips broadcast when tournamentIds are empty', async () => {
      await service.broadcastMutation({ ...payload, tournamentIds: [] });

      expect(realtime.published).toHaveLength(0);
    });

    it('broadcasts to multiple tournament rooms', async () => {
      const multiPayload = { ...payload, tournamentIds: ['t1', 't2'] };
      await service.broadcastMutation(multiPayload);

      expect(realtime.to('tournament:t1')).toHaveLength(1);
      expect(realtime.to('tournament:t2')).toHaveLength(1);
      expect(realtime.published).toHaveLength(2);
    });

    it('handles tournamentId (singular) in payload', async () => {
      const singlePayload = { tournamentId: 'tid-1', methods: payload.methods };
      await service.broadcastMutation(singlePayload);

      expect(realtime.to('tournament:tid-1')).toHaveLength(1);
    });

    it('does not throw when the transport cannot deliver', async () => {
      // An unbound namespace makes publish return false; the adapter owns the warning (see its spec).
      const undeliverable = new RecordingRealtime();
      vi.spyOn(undeliverable, 'publish').mockReturnValue(false);
      const freshService = new TournamentBroadcastService(undeliverable, undeliverable);
      await expect(freshService.broadcastMutation(payload)).resolves.toBeUndefined();
    });

    it('carries originClientId when the mutation supplied one', async () => {
      await service.broadcastMutation({ ...payload, originClientId: 'tab-1' });

      expect(realtime.to('tournament:tournament-123')[0].payload.originClientId).toBe('tab-1');
    });

    it('omits originClientId when the mutation did not supply one', async () => {
      await service.broadcastMutation(payload);

      expect(realtime.to('tournament:tournament-123')[0].payload).not.toHaveProperty('originClientId');
    });
  });

  describe('broadcastPublicNotices', () => {
    it('broadcasts matchUp updates to public gateway', () => {
      const payload = { tournamentIds: ['t1'] };
      const publicNotices = [
        {
          topic: topicConstants.MODIFY_MATCHUP,
          tournamentId: 't1',
          matchUp: { matchUpId: 'm1', matchUpStatus: 'COMPLETED' },
        },
      ];

      service.broadcastPublicNotices(payload, publicNotices);

      expect(publicUpdates('t1')).toContainEqual({
        type: 'matchUpUpdate',
        tournamentId: 't1',
        matchUps: [{ matchUpId: 'm1', matchUpStatus: 'COMPLETED' }],
        positionAssignments: [],
      });
    });

    it('broadcasts publish change notices', () => {
      const payload = { tournamentIds: ['t1'] };
      const publicNotices = [
        { topic: topicConstants.PUBLISH_EVENT, tournamentId: 't1', eventId: 'e1' },
      ];

      service.broadcastPublicNotices(payload, publicNotices);

      expect(publicUpdates('t1')).toContainEqual({
        type: 'publishChange',
        tournamentId: 't1',
        action: topicConstants.PUBLISH_EVENT,
        eventId: 'e1',
      });
    });

    it('does nothing when publicNotices is empty', () => {
      service.broadcastPublicNotices({ tournamentIds: ['t1'] }, []);
      expect(realtime.published).toHaveLength(0);
    });

    it('does nothing when publicNotices is undefined', () => {
      service.broadcastPublicNotices({ tournamentIds: ['t1'] }, undefined);
      expect(realtime.published).toHaveLength(0);
    });

    // Moved from public.gateway.spec.ts ('broadcastPublicUpdate skips when no tournamentId').
    it('publishes nothing for a notice with no tournamentId', () => {
      service.broadcastPublicNotices({}, [{ topic: topicConstants.MODIFY_MATCHUP, matchUp: { matchUpId: 'm1' } }]);
      expect(realtime.published).toHaveLength(0);
    });

    it('groups notices by tournamentId', () => {
      const payload = { tournamentIds: ['t1'] };
      const publicNotices = [
        { topic: topicConstants.MODIFY_MATCHUP, tournamentId: 't1', matchUp: { matchUpId: 'm1' } },
        { topic: topicConstants.MODIFY_MATCHUP, tournamentId: 't2', matchUp: { matchUpId: 'm2' } },
      ];

      service.broadcastPublicNotices(payload, publicNotices);

      expect(allPublicUpdates()).toHaveLength(2);
      expect(publicUpdates('t1')).toContainEqual(expect.objectContaining({ matchUps: [{ matchUpId: 'm1' }] }));
      expect(publicUpdates('t2')).toContainEqual(expect.objectContaining({ matchUps: [{ matchUpId: 'm2' }] }));
    });

    it('includes position assignment notices alongside matchUp notices', () => {
      const payload = { tournamentIds: ['t1'] };
      const publicNotices = [
        { topic: topicConstants.MODIFY_MATCHUP, tournamentId: 't1', matchUp: { matchUpId: 'm1' } },
        { topic: topicConstants.MODIFY_POSITION_ASSIGNMENTS, tournamentId: 't1', positionAssignments: [{ drawPosition: 1 }], structureId: 's1', drawId: 'd1' },
      ];

      service.broadcastPublicNotices(payload, publicNotices);

      expect(publicUpdates('t1')).toContainEqual({
        type: 'matchUpUpdate',
        tournamentId: 't1',
        matchUps: [{ matchUpId: 'm1' }],
        positionAssignments: [{ assignments: [{ drawPosition: 1 }], structureId: 's1', drawId: 'd1' }],
      });
    });

    describe('Phase 1.5 — liveScore for non-INTENNSE matchUps', () => {
      it('emits broadcastLiveScore alongside broadcastPublicUpdate for each matchUp notice', () => {
        const payload = { tournamentIds: ['t1'] };
        const publicNotices = [
          {
            topic: topicConstants.MODIFY_MATCHUP,
            tournamentId: 't1',
            matchUp: {
              matchUpId: 'm1',
              matchUpFormat: 'SET3-S:6/TB7',
              sides: [
                { sideNumber: 1, participant: { participantName: 'Alice' } },
                { sideNumber: 2, participant: { participantName: 'Bob' } },
              ],
              score: { sets: [{ side1Score: 6, side2Score: 4 }] },
            },
          },
        ];

        service.broadcastPublicNotices(payload, publicNotices);

        expect(allLiveScores()).toHaveLength(1);
        const [livePayload] = liveScores('t1');
        expect(livePayload.matchUpId).toBe('m1');
        expect(livePayload.tournamentId).toBe('t1');
        expect(livePayload.format).toBe('STANDARD');
        expect(livePayload.status).toBe('in_progress');
        expect(livePayload.side1.playerName).toBe('Alice');
        expect(livePayload.side1.setScores).toEqual([6]);
        expect(livePayload.side2.setScores).toEqual([4]);
      });

      it('emits one broadcastLiveScore call per matchUp when multiple matchUps are in the same notice batch', () => {
        const payload = { tournamentIds: ['t1'] };
        const publicNotices = [
          {
            topic: topicConstants.MODIFY_MATCHUP,
            tournamentId: 't1',
            matchUp: { matchUpId: 'm1', sides: [], score: { sets: [] } },
          },
          {
            topic: topicConstants.MODIFY_MATCHUP,
            tournamentId: 't1',
            matchUp: { matchUpId: 'm2', sides: [], score: { sets: [] } },
          },
          {
            topic: topicConstants.MODIFY_MATCHUP,
            tournamentId: 't1',
            matchUp: { matchUpId: 'm3', sides: [], score: { sets: [] } },
          },
        ];

        service.broadcastPublicNotices(payload, publicNotices);

        expect(allLiveScores()).toHaveLength(3);
        const matchUpIds = liveScores('t1').map((p) => p.matchUpId);
        expect(matchUpIds.sort((a, b) => a.localeCompare(b))).toEqual(['m1', 'm2', 'm3']);
      });

      it('does not emit broadcastLiveScore when there are no matchUp notices', () => {
        const payload = { tournamentIds: ['t1'] };
        const publicNotices = [
          { topic: topicConstants.PUBLISH_EVENT, tournamentId: 't1', eventId: 'e1' },
        ];

        service.broadcastPublicNotices(payload, publicNotices);

        expect(allLiveScores()).toHaveLength(0);
      });

      it('emits broadcastLiveScore per tournament when notices span multiple tournaments', () => {
        const payload = { tournamentIds: ['t1', 't2'] };
        const publicNotices = [
          {
            topic: topicConstants.MODIFY_MATCHUP,
            tournamentId: 't1',
            matchUp: { matchUpId: 'm1', sides: [], score: { sets: [] } },
          },
          {
            topic: topicConstants.MODIFY_MATCHUP,
            tournamentId: 't2',
            matchUp: { matchUpId: 'm2', sides: [], score: { sets: [] } },
          },
        ];

        service.broadcastPublicNotices(payload, publicNotices);

        expect(allLiveScores()).toHaveLength(2);
        expect(liveScores('t1')).toContainEqual(expect.objectContaining({ matchUpId: 'm1' }));
        expect(liveScores('t2')).toContainEqual(expect.objectContaining({ matchUpId: 'm2' }));
      });

      it('skips matchUps that the transform rejects (e.g. missing matchUpId)', () => {
        const payload = { tournamentIds: ['t1'] };
        const publicNotices = [
          {
            topic: topicConstants.MODIFY_MATCHUP,
            tournamentId: 't1',
            matchUp: { sides: [], score: { sets: [] } }, // no matchUpId
          },
        ];

        service.broadcastPublicNotices(payload, publicNotices);

        expect(allLiveScores()).toHaveLength(0);
        // The publicUpdate batch still fires even though the live transform rejects
        expect(allPublicUpdates().length).toBeGreaterThan(0);
      });
    });

    describe('Phase 3 slice 6 — matchup-finalized webhook trigger', () => {
      it('invokes ProjectorService.projectMatchUpFinalized with the matchUp notices', () => {
        const payload = { tournamentIds: ['t1'] };
        const publicNotices = [
          {
            topic: topicConstants.MODIFY_MATCHUP,
            tournamentId: 't1',
            matchUp: { matchUpId: 'mu-1', winningSide: 1 },
          },
        ];

        service.broadcastPublicNotices(payload, publicNotices);

        expect(projectorService.projectMatchUpFinalized).toHaveBeenCalledTimes(1);
        const passedNotices = projectorService.projectMatchUpFinalized.mock.calls[0][0];
        expect(passedNotices).toHaveLength(1);
        expect(passedNotices[0].matchUp.matchUpId).toBe('mu-1');
      });

      it('does not invoke the projector when there are no matchUp notices', () => {
        const payload = { tournamentIds: ['t1'] };
        const publicNotices = [
          { topic: topicConstants.PUBLISH_EVENT, tournamentId: 't1', eventId: 'e1' },
        ];

        service.broadcastPublicNotices(payload, publicNotices);

        expect(projectorService.projectMatchUpFinalized).not.toHaveBeenCalled();
      });

      it('invokes once per tournament when notices span multiple tournaments', () => {
        const payload = { tournamentIds: ['t1', 't2'] };
        const publicNotices = [
          {
            topic: topicConstants.MODIFY_MATCHUP,
            tournamentId: 't1',
            matchUp: { matchUpId: 'mu-1', winningSide: 1 },
          },
          {
            topic: topicConstants.MODIFY_MATCHUP,
            tournamentId: 't2',
            matchUp: { matchUpId: 'mu-2', matchUpStatus: 'COMPLETED' },
          },
        ];

        service.broadcastPublicNotices(payload, publicNotices);

        // Once per tournament — each call carries that tournament's matchUp notices
        expect(projectorService.projectMatchUpFinalized).toHaveBeenCalledTimes(2);
      });

      it('does not propagate a synchronous throw from the projector', () => {
        projectorService.projectMatchUpFinalized.mockImplementation(() => {
          throw new Error('projector boom');
        });
        const payload = { tournamentIds: ['t1'] };
        const publicNotices = [
          {
            topic: topicConstants.MODIFY_MATCHUP,
            tournamentId: 't1',
            matchUp: { matchUpId: 'mu-1', winningSide: 1 },
          },
        ];

        expect(() => service.broadcastPublicNotices(payload, publicNotices)).not.toThrow();
        // Ensure broadcastPublicUpdate still fired (no shortcut)
        expect(allPublicUpdates().length).toBeGreaterThan(0);
      });

      it('works when the projector service is not injected (disabled state)', () => {
        const standaloneService = new TournamentBroadcastService(realtime, realtime);
        const payload = { tournamentIds: ['t1'] };
        const publicNotices = [
          {
            topic: topicConstants.MODIFY_MATCHUP,
            tournamentId: 't1',
            matchUp: { matchUpId: 'mu-1', winningSide: 1 },
          },
        ];

        expect(() => standaloneService.broadcastPublicNotices(payload, publicNotices)).not.toThrow();
        expect(allPublicUpdates().length).toBeGreaterThan(0);
      });
    });
  });
});
