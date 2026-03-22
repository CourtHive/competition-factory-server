import { TournamentBroadcastService } from './tournament-broadcast.service';
import { PublicGateway } from '../public/public.gateway';
import { topicConstants } from 'tods-competition-factory';

describe('TournamentBroadcastService', () => {
  let service: TournamentBroadcastService;
  let publicGateway: { broadcastPublicUpdate: jest.Mock };
  let mockServer: { to: jest.Mock; in: jest.Mock };
  let mockSocket: { id: string; to: jest.Mock };

  beforeEach(() => {
    publicGateway = { broadcastPublicUpdate: jest.fn() };
    service = new TournamentBroadcastService(publicGateway as unknown as PublicGateway);

    // Mock Socket.IO server — server.to(room).emit() and server.in(room).fetchSockets()
    const emitFn = jest.fn();
    mockServer = {
      to: jest.fn().mockReturnValue({ emit: emitFn }),
      in: jest.fn().mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([]) }),
    };

    // Mock sender socket — sender.to(room).emit() excludes sender
    const senderEmitFn = jest.fn();
    mockSocket = {
      id: 'sender-socket-id',
      to: jest.fn().mockReturnValue({ emit: senderEmitFn }),
    };

    service.setTmxServer(mockServer as any);
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

      expect(mockServer.to).toHaveBeenCalledWith('tournament:tournament-123');
      expect(mockServer.to('tournament:tournament-123').emit).toHaveBeenCalledWith(
        'tournamentMutation',
        expect.objectContaining({
          methods: payload.methods,
          tournamentIds: payload.tournamentIds,
          userId: payload.userId,
        }),
      );
    });

    it('broadcasts excluding sender when sender provided (Socket.IO path)', async () => {
      await service.broadcastMutation(payload, mockSocket as any);

      expect(mockSocket.to).toHaveBeenCalledWith('tournament:tournament-123');
      expect(mockSocket.to('tournament:tournament-123').emit).toHaveBeenCalledWith(
        'tournamentMutation',
        expect.objectContaining({
          methods: payload.methods,
          tournamentIds: payload.tournamentIds,
        }),
      );
      // Server.to should NOT have been called for the broadcast
      // (only for fetchSockets via server.in)
      expect(mockServer.to).not.toHaveBeenCalled();
    });

    it('skips broadcast when methods are empty', async () => {
      await service.broadcastMutation({ ...payload, methods: [] });

      expect(mockServer.to).not.toHaveBeenCalled();
      expect(mockSocket.to).not.toHaveBeenCalled();
    });

    it('skips broadcast when tournamentIds are empty', async () => {
      await service.broadcastMutation({ ...payload, tournamentIds: [] });

      expect(mockServer.to).not.toHaveBeenCalled();
    });

    it('broadcasts to multiple tournament rooms', async () => {
      const multiPayload = { ...payload, tournamentIds: ['t1', 't2'] };
      await service.broadcastMutation(multiPayload);

      expect(mockServer.to).toHaveBeenCalledWith('tournament:t1');
      expect(mockServer.to).toHaveBeenCalledWith('tournament:t2');
      expect(mockServer.to).toHaveBeenCalledTimes(2);
    });

    it('handles tournamentId (singular) in payload', async () => {
      const singlePayload = { tournamentId: 'tid-1', methods: payload.methods };
      await service.broadcastMutation(singlePayload);

      expect(mockServer.to).toHaveBeenCalledWith('tournament:tid-1');
    });

    it('warns when tmxServer is not set', async () => {
      const freshService = new TournamentBroadcastService(publicGateway as unknown as PublicGateway);
      // Should not throw, just warn and return
      await freshService.broadcastMutation(payload);
      expect(mockServer.to).not.toHaveBeenCalled();
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

      expect(publicGateway.broadcastPublicUpdate).toHaveBeenCalledWith('t1', {
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

      expect(publicGateway.broadcastPublicUpdate).toHaveBeenCalledWith('t1', {
        type: 'publishChange',
        tournamentId: 't1',
        action: topicConstants.PUBLISH_EVENT,
        eventId: 'e1',
      });
    });

    it('does nothing when publicNotices is empty', () => {
      service.broadcastPublicNotices({ tournamentIds: ['t1'] }, []);
      expect(publicGateway.broadcastPublicUpdate).not.toHaveBeenCalled();
    });

    it('does nothing when publicNotices is undefined', () => {
      service.broadcastPublicNotices({ tournamentIds: ['t1'] }, undefined);
      expect(publicGateway.broadcastPublicUpdate).not.toHaveBeenCalled();
    });

    it('groups notices by tournamentId', () => {
      const payload = { tournamentIds: ['t1'] };
      const publicNotices = [
        { topic: topicConstants.MODIFY_MATCHUP, tournamentId: 't1', matchUp: { matchUpId: 'm1' } },
        { topic: topicConstants.MODIFY_MATCHUP, tournamentId: 't2', matchUp: { matchUpId: 'm2' } },
      ];

      service.broadcastPublicNotices(payload, publicNotices);

      expect(publicGateway.broadcastPublicUpdate).toHaveBeenCalledTimes(2);
      expect(publicGateway.broadcastPublicUpdate).toHaveBeenCalledWith('t1', expect.objectContaining({ matchUps: [{ matchUpId: 'm1' }] }));
      expect(publicGateway.broadcastPublicUpdate).toHaveBeenCalledWith('t2', expect.objectContaining({ matchUps: [{ matchUpId: 'm2' }] }));
    });

    it('includes position assignment notices alongside matchUp notices', () => {
      const payload = { tournamentIds: ['t1'] };
      const publicNotices = [
        { topic: topicConstants.MODIFY_MATCHUP, tournamentId: 't1', matchUp: { matchUpId: 'm1' } },
        { topic: topicConstants.MODIFY_POSITION_ASSIGNMENTS, tournamentId: 't1', positionAssignments: [{ drawPosition: 1 }], structureId: 's1', drawId: 'd1' },
      ];

      service.broadcastPublicNotices(payload, publicNotices);

      expect(publicGateway.broadcastPublicUpdate).toHaveBeenCalledWith('t1', {
        type: 'matchUpUpdate',
        tournamentId: 't1',
        matchUps: [{ matchUpId: 'm1' }],
        positionAssignments: [{ assignments: [{ drawPosition: 1 }], structureId: 's1', drawId: 'd1' }],
      });
    });
  });
});
