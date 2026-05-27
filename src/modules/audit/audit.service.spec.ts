import { AuditService } from './audit.service';

describe('AuditService', () => {
  let service: AuditService;
  let mockStorage: any;

  beforeEach(() => {
    mockStorage = {
      append: jest.fn().mockResolvedValue(undefined),
      findByTournamentId: jest.fn().mockResolvedValue([]),
      findByActionType: jest.fn().mockResolvedValue([]),
      prune: jest.fn().mockResolvedValue(0),
    };
    service = new AuditService(mockStorage);
  });

  describe('recordMutation', () => {
    it('appends one audit row per tournamentId', async () => {
      await service.recordMutation({
        tournamentIds: ['t-1', 't-2'],
        userId: 'user-1',
        userEmail: 'test@test.com',
        methods: [{ method: 'addEvent', params: { eventName: 'Test' } }],
        status: 'applied',
      });

      expect(mockStorage.append).toHaveBeenCalledTimes(2);
      const row1 = mockStorage.append.mock.calls[0][0];
      expect(row1.tournamentId).toBe('t-1');
      expect(row1.actionType).toBe('MUTATION');
      expect(row1.methods[0].method).toBe('addEvent');
      expect(row1.userId).toBe('user-1');

      const row2 = mockStorage.append.mock.calls[1][0];
      expect(row2.tournamentId).toBe('t-2');
    });

    it('does not throw when storage.append fails (fail-soft)', async () => {
      mockStorage.append.mockRejectedValue(new Error('DB down'));
      await expect(
        service.recordMutation({
          tournamentIds: ['t-1'],
          methods: [{ method: 'setTournamentDates' }],
          status: 'applied',
        }),
      ).resolves.not.toThrow();
    });

    it('persists optional metadata (e.g. ackId for client correlation)', async () => {
      await service.recordMutation({
        tournamentIds: ['t-1'],
        methods: [{ method: 'addEvent', params: { eventName: 'Test' } }],
        status: 'applied',
        metadata: { ackId: 'ack-xyz', tmxVersion: '1.2.3' },
      });
      const row = mockStorage.append.mock.calls[0][0];
      expect(row.metadata).toEqual({ ackId: 'ack-xyz', tmxVersion: '1.2.3' });
    });

    it('omits metadata when undefined or empty', async () => {
      await service.recordMutation({
        tournamentIds: ['t-1'],
        methods: [{ method: 'addEvent' }],
        status: 'applied',
        metadata: {},
      });
      const row = mockStorage.append.mock.calls[0][0];
      expect(row.metadata).toBeUndefined();
    });

    it('captures errorCode + status=rejected for failed mutations', async () => {
      await service.recordMutation({
        tournamentIds: ['t-1'],
        methods: [{ method: 'modifyCourt', params: { courtId: 'ghost-1' } }],
        status: 'rejected',
        errorCode: 'ERR_NOT_FOUND_COURT',
      });
      const row = mockStorage.append.mock.calls[0][0];
      expect(row.status).toBe('rejected');
      expect(row.errorCode).toBe('ERR_NOT_FOUND_COURT');
      expect(row.methods[0].params.courtId).toBe('ghost-1');
    });
  });

  describe('recordDeletion', () => {
    it('appends a DELETE_TOURNAMENT row with metadata', async () => {
      await service.recordDeletion({
        tournamentId: 't-1',
        tournamentName: 'My Tournament',
        providerId: 'prov-1',
        userId: 'user-1',
        userEmail: 'admin@test.com',
      });

      expect(mockStorage.append).toHaveBeenCalledTimes(1);
      const row = mockStorage.append.mock.calls[0][0];
      expect(row.actionType).toBe('DELETE_TOURNAMENT');
      expect(row.metadata.tournamentName).toBe('My Tournament');
      expect(row.metadata.providerId).toBe('prov-1');
    });

    it('does not throw when storage.append fails', async () => {
      mockStorage.append.mockRejectedValue(new Error('DB down'));
      await expect(
        service.recordDeletion({ tournamentId: 't-1' }),
      ).resolves.not.toThrow();
    });
  });

  describe('recordSave', () => {
    it('appends a SAVE row', async () => {
      await service.recordSave({
        tournamentId: 't-1',
        userId: 'user-1',
        userEmail: 'test@test.com',
      });

      expect(mockStorage.append).toHaveBeenCalledTimes(1);
      const row = mockStorage.append.mock.calls[0][0];
      expect(row.actionType).toBe('SAVE');
      expect(row.tournamentId).toBe('t-1');
    });
  });

  describe('getAuditTrail', () => {
    it('queries by tournamentId', async () => {
      mockStorage.findByTournamentId.mockResolvedValue([
        { auditId: 'a-1', tournamentId: 't-1', actionType: 'MUTATION' },
      ]);

      let result: any = await service.getAuditTrail({ tournamentId: 't-1' });
      expect(result.success).toBe(true);
      expect(result.auditRows).toHaveLength(1);
      expect(mockStorage.findByTournamentId).toHaveBeenCalledWith('t-1', { tournamentId: 't-1' });
    });
  });

  describe('getDeletedTournaments', () => {
    it('queries by DELETE_TOURNAMENT action type', async () => {
      mockStorage.findByActionType.mockResolvedValue([
        { auditId: 'a-1', actionType: 'DELETE_TOURNAMENT', metadata: { tournamentName: 'Deleted One' } },
      ]);

      let result: any = await service.getDeletedTournaments();
      expect(result.success).toBe(true);
      expect(result.auditRows).toHaveLength(1);
      expect(mockStorage.findByActionType).toHaveBeenCalledWith('DELETE_TOURNAMENT', undefined);
    });
  });

  describe('recordDrawDeletion', () => {
    it('appends a DELETE_DRAW row with the snapshot in metadata', async () => {
      const snapshot = { drawId: 'd-1', drawName: 'MD32', drawType: 'SINGLE_ELIMINATION', structures: [] };
      await service.recordDrawDeletion({
        tournamentId: 't-1',
        eventId: 'e-1',
        drawId: 'd-1',
        drawName: 'MD32',
        drawType: 'SINGLE_ELIMINATION',
        deletedDrawSnapshot: snapshot,
        userId: 'user-1',
        userEmail: 'admin@test.com',
      });

      expect(mockStorage.append).toHaveBeenCalledTimes(1);
      const row = mockStorage.append.mock.calls[0][0];
      expect(row.actionType).toBe('DELETE_DRAW');
      expect(row.tournamentId).toBe('t-1');
      expect(row.metadata.deletedDrawSnapshot).toEqual(snapshot);
      expect(row.metadata.eventId).toBe('e-1');
      expect(row.metadata.drawId).toBe('d-1');
      expect(row.methods[0].method).toBe('deleteDrawDefinitions');
      expect(row.methods[0].params.drawIds).toEqual(['d-1']);
    });

    it('does not throw when storage.append fails (fail-soft)', async () => {
      mockStorage.append.mockRejectedValue(new Error('DB down'));
      await expect(
        service.recordDrawDeletion({
          tournamentId: 't-1',
          drawId: 'd-1',
          deletedDrawSnapshot: { drawId: 'd-1' },
        }),
      ).resolves.not.toThrow();
    });

    it('preserves auditData when provided', async () => {
      await service.recordDrawDeletion({
        tournamentId: 't-1',
        drawId: 'd-1',
        deletedDrawSnapshot: { drawId: 'd-1' },
        auditData: { reason: 'user-initiated' },
      });
      const row = mockStorage.append.mock.calls[0][0];
      expect(row.metadata.auditData).toEqual({ reason: 'user-initiated' });
    });

    it('omits auditData when not provided', async () => {
      await service.recordDrawDeletion({
        tournamentId: 't-1',
        drawId: 'd-1',
        deletedDrawSnapshot: { drawId: 'd-1' },
      });
      const row = mockStorage.append.mock.calls[0][0];
      expect(row.metadata.auditData).toBeUndefined();
    });
  });

  describe('getDeletedDraws', () => {
    it('queries by tournamentId and filters to DELETE_DRAW', async () => {
      mockStorage.findByTournamentId.mockResolvedValue([
        { auditId: 'a-1', actionType: 'DELETE_DRAW', metadata: { drawId: 'd-1', eventId: 'e-1' } },
        { auditId: 'a-2', actionType: 'MUTATION', metadata: {} },
      ]);

      const result: any = await service.getDeletedDraws({ tournamentId: 't-1' });
      expect(result.success).toBe(true);
      expect(result.auditRows).toHaveLength(1);
      expect(result.auditRows[0].actionType).toBe('DELETE_DRAW');
      expect(mockStorage.findByTournamentId).toHaveBeenCalledWith('t-1', expect.any(Object));
    });

    it('queries by action type when no tournamentId is given', async () => {
      mockStorage.findByActionType.mockResolvedValue([
        { auditId: 'a-1', actionType: 'DELETE_DRAW', metadata: { drawId: 'd-1', eventId: 'e-1' } },
      ]);
      const result: any = await service.getDeletedDraws();
      expect(result.success).toBe(true);
      expect(result.auditRows).toHaveLength(1);
      expect(mockStorage.findByActionType).toHaveBeenCalledWith('DELETE_DRAW', undefined);
    });

    it('filters by eventId in metadata when provided', async () => {
      mockStorage.findByActionType.mockResolvedValue([
        { auditId: 'a-1', actionType: 'DELETE_DRAW', metadata: { drawId: 'd-1', eventId: 'e-1' } },
        { auditId: 'a-2', actionType: 'DELETE_DRAW', metadata: { drawId: 'd-2', eventId: 'e-2' } },
      ]);
      const result: any = await service.getDeletedDraws({ eventId: 'e-2' });
      expect(result.auditRows).toHaveLength(1);
      expect(result.auditRows[0].metadata.drawId).toBe('d-2');
    });
  });
});
