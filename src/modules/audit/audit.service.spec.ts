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
});
