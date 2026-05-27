import { executionQueue } from '../factory/functions/private/executionQueue';
import { AuditService } from './audit.service';

jest.mock('../factory/functions/private/executionQueue', () => ({
  executionQueue: jest.fn(),
}));

describe('AuditService', () => {
  let service: AuditService;
  let mockStorage: any;

  beforeEach(() => {
    mockStorage = {
      append: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn().mockResolvedValue(null),
      findByTournamentId: jest.fn().mockResolvedValue([]),
      findByActionType: jest.fn().mockResolvedValue([]),
      prune: jest.fn().mockResolvedValue(0),
    };
    service = new AuditService(mockStorage);
    (executionQueue as jest.Mock).mockReset();
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

  describe('restoreDraw', () => {
    const mockStorageSvc: any = { fetchTournamentRecords: jest.fn(), saveTournamentRecords: jest.fn() };
    const deletedRow = {
      auditId: 'audit-1',
      tournamentId: 't-1',
      actionType: 'DELETE_DRAW',
      methods: [],
      status: 'applied',
      occurredAt: '2026-05-27T00:00:00Z',
      metadata: {
        eventId: 'e-1',
        drawId: 'd-1',
        drawName: 'MD32',
        drawType: 'SINGLE_ELIMINATION',
        deletedDrawSnapshot: { drawId: 'd-1', drawName: 'MD32' },
      },
    };

    beforeEach(() => {
      service = new AuditService(mockStorage, mockStorageSvc);
    });

    it('rejects when auditId is missing', async () => {
      const result = await service.restoreDraw({ auditId: '' });
      expect(result.error).toBe('MISSING_AUDIT_ID');
    });

    it('rejects when the storage service is not wired', async () => {
      service = new AuditService(mockStorage);
      const result = await service.restoreDraw({ auditId: 'audit-1' });
      expect(result.error).toBe('STORAGE_NOT_CONFIGURED');
    });

    it('rejects when the audit row does not exist', async () => {
      mockStorage.findById.mockResolvedValue(null);
      const result = await service.restoreDraw({ auditId: 'audit-1' });
      expect(result.error).toBe('AUDIT_ROW_NOT_FOUND');
    });

    it('rejects when the audit row is not a DELETE_DRAW', async () => {
      mockStorage.findById.mockResolvedValue({ ...deletedRow, actionType: 'MUTATION' });
      const result = await service.restoreDraw({ auditId: 'audit-1' });
      expect(result.error).toBe('INVALID_AUDIT_TYPE');
    });

    it('rejects when the snapshot is missing', async () => {
      mockStorage.findById.mockResolvedValue({
        ...deletedRow,
        metadata: { ...deletedRow.metadata, deletedDrawSnapshot: undefined },
      });
      const result = await service.restoreDraw({ auditId: 'audit-1' });
      expect(result.error).toBe('MISSING_SNAPSHOT');
    });

    it('rejects when the eventId is missing', async () => {
      mockStorage.findById.mockResolvedValue({
        ...deletedRow,
        metadata: { ...deletedRow.metadata, eventId: undefined },
      });
      const result = await service.restoreDraw({ auditId: 'audit-1' });
      expect(result.error).toBe('MISSING_EVENT_ID');
    });

    it('rejects when a prior RESTORE_DRAW already references the audit row', async () => {
      mockStorage.findById.mockResolvedValue(deletedRow);
      mockStorage.findByTournamentId.mockResolvedValue([
        { actionType: 'RESTORE_DRAW', metadata: { restoredFromAuditId: 'audit-1' } },
      ]);
      const result = await service.restoreDraw({ auditId: 'audit-1' });
      expect(result.error).toBe('ALREADY_RESTORED');
      expect(executionQueue).not.toHaveBeenCalled();
    });

    it('runs executionQueue with addDrawDefinition and appends RESTORE_DRAW on success', async () => {
      mockStorage.findById.mockResolvedValue(deletedRow);
      (executionQueue as jest.Mock).mockResolvedValue({ success: true });

      const result = await service.restoreDraw({ auditId: 'audit-1', userId: 'u-1', userEmail: 'u@test.com' });
      expect(result.success).toBe(true);
      expect(result.drawId).toBe('d-1');
      expect(result.eventId).toBe('e-1');

      const call = (executionQueue as jest.Mock).mock.calls[0];
      expect(call[0].tournamentIds).toEqual(['t-1']);
      expect(call[0].methods[0].method).toBe('addDrawDefinition');
      expect(call[0].methods[0].params.eventId).toBe('e-1');
      expect(call[0].methods[0].params.drawDefinition).toEqual(deletedRow.metadata.deletedDrawSnapshot);
      expect(call[0].source).toBe('audit-restore');

      const appended = mockStorage.append.mock.calls.find((c) => c[0].actionType === 'RESTORE_DRAW');
      expect(appended).toBeDefined();
      expect(appended[0].metadata.restoredFromAuditId).toBe('audit-1');
      expect(appended[0].metadata.drawId).toBe('d-1');
      expect(appended[0].userId).toBe('u-1');
    });

    it('returns the factory error and skips the RESTORE_DRAW row when executionQueue fails', async () => {
      mockStorage.findById.mockResolvedValue(deletedRow);
      (executionQueue as jest.Mock).mockResolvedValue({ error: 'DRAW_ID_EXISTS' });

      const result = await service.restoreDraw({ auditId: 'audit-1' });
      expect(result.error).toBe('DRAW_ID_EXISTS');
      const appended = mockStorage.append.mock.calls.find((c) => c[0].actionType === 'RESTORE_DRAW');
      expect(appended).toBeUndefined();
    });
  });
});
