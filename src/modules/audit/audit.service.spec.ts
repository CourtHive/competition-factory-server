import { Logger } from '@nestjs/common';
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
      findByActor: jest.fn().mockResolvedValue([]),
      prune: jest.fn().mockResolvedValue(0),
      incrementFailureCount: jest.fn().mockResolvedValue(undefined),
      clearFailureCount: jest.fn().mockResolvedValue(undefined),
      loadFailureCounts: jest.fn().mockResolvedValue([]),
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

  describe('getByActor', () => {
    it('forwards actorType + actorId to the storage query', async () => {
      mockStorage.findByActor.mockResolvedValue([
        { auditId: 'a-1', actor: { kind: 'provisioner', id: 'pv-1' }, actionType: 'TRACKER_TOKEN_ISSUED' },
      ]);
      const result: any = await service.getByActor({ actorType: 'provisioner', actorId: 'pv-1' });
      expect(result.success).toBe(true);
      expect(result.auditRows).toHaveLength(1);
      expect(mockStorage.findByActor).toHaveBeenCalledWith('provisioner', 'pv-1', expect.any(Object));
    });

    it('threads from/to/limit into the storage call', async () => {
      mockStorage.findByActor.mockResolvedValue([]);
      await service.getByActor({
        actorType: 'user',
        actorId: 'u-1',
        from: '2026-01-01T00:00:00Z',
        to: '2026-02-01T00:00:00Z',
        limit: 50,
      });
      expect(mockStorage.findByActor).toHaveBeenCalledWith(
        'user',
        'u-1',
        expect.objectContaining({
          from: '2026-01-01T00:00:00Z',
          to: '2026-02-01T00:00:00Z',
          limit: 50,
        }),
      );
    });
  });

  describe('recordContactEmailChanged', () => {
    it('appends a CONTACT_EMAIL_CHANGED row using the target userId in the tournamentId slot', async () => {
      await service.recordContactEmailChanged({
        targetUserId: 'u-target',
        targetEmail: 'target@login',
        actorUserId: 'u-admin',
        actorEmail: 'admin@test',
        oldContactEmail: 'old@example.com',
        newContactEmail: 'new@example.com',
        source: 'admin',
      });
      expect(mockStorage.append).toHaveBeenCalledTimes(1);
      const row = mockStorage.append.mock.calls[0][0];
      expect(row.actionType).toBe('CONTACT_EMAIL_CHANGED');
      expect(row.tournamentId).toBe('u-target');
      expect(row.userId).toBe('u-admin');
      expect(row.userEmail).toBe('admin@test');
      expect(row.source).toBe('admin');
      expect(row.status).toBe('applied');
      expect(row.metadata).toEqual({
        targetUserId: 'u-target',
        targetEmail: 'target@login',
        oldContactEmail: 'old@example.com',
        newContactEmail: 'new@example.com',
      });
    });

    it('captures a null oldContactEmail when none was set', async () => {
      await service.recordContactEmailChanged({
        targetUserId: 'u-target',
        newContactEmail: 'new@example.com',
      });
      const row = mockStorage.append.mock.calls[0][0];
      expect(row.metadata.oldContactEmail).toBeNull();
      expect(row.source).toBe('admin');
    });

    it('does not throw when storage.append fails (fail-soft)', async () => {
      mockStorage.append.mockRejectedValue(new Error('DB down'));
      await expect(
        service.recordContactEmailChanged({
          targetUserId: 'u-target',
          newContactEmail: 'new@example.com',
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('recordContactEmailVerified', () => {
    it('appends a CONTACT_EMAIL_VERIFIED row with source=verify-link', async () => {
      await service.recordContactEmailVerified({
        targetUserId: 'u-target',
        targetEmail: 'target@login',
        contactEmail: 'verified@example.com',
      });
      const row = mockStorage.append.mock.calls[0][0];
      expect(row.actionType).toBe('CONTACT_EMAIL_VERIFIED');
      expect(row.tournamentId).toBe('u-target');
      expect(row.userId).toBe('u-target');
      expect(row.userEmail).toBe('target@login');
      expect(row.source).toBe('verify-link');
      expect(row.metadata).toEqual({
        targetUserId: 'u-target',
        targetEmail: 'target@login',
        contactEmail: 'verified@example.com',
      });
    });

    it('does not throw when storage.append fails (fail-soft)', async () => {
      mockStorage.append.mockRejectedValue(new Error('DB down'));
      await expect(
        service.recordContactEmailVerified({
          targetUserId: 'u-target',
          contactEmail: 'verified@example.com',
        }),
      ).resolves.not.toThrow();
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

  // T2 — actor stamping (migration 036's polymorphic actor must reach
  // the row regardless of caller shape) and failure/recovery throttling
  // (counter milestones + post-failure recovery emission).
  describe('actor stamping', () => {
    it('stamps actor: { kind: "provider", id } when only providerId is provided', async () => {
      await service.recordTrackerTokenIssued({
        tournamentId: 't-1',
        providerId: '11111111-1111-1111-1111-111111111111',
        audience: 'score',
        ttlSeconds: 3600,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
      const row = mockStorage.append.mock.calls[0][0];
      expect(row.actor).toEqual({ kind: 'provider', id: '11111111-1111-1111-1111-111111111111' });
    });

    it('stamps actor: { kind: "provisioner", id } when provisionerId is provided', async () => {
      await service.recordTrackerTokenIssued({
        tournamentId: 't-1',
        provisionerId: '22222222-2222-2222-2222-222222222222',
        audience: 'admin',
        ttlSeconds: 60,
        expiresAt: new Date().toISOString(),
      });
      const row = mockStorage.append.mock.calls[0][0];
      expect(row.actor).toEqual({ kind: 'provisioner', id: '22222222-2222-2222-2222-222222222222' });
    });

    it('stamps actor: { kind: "user", id } when only a bare uuid userId is provided', async () => {
      await service.recordMutation({
        tournamentIds: ['t-1'],
        userId: '33333333-3333-3333-3333-333333333333',
        methods: [{ method: 'addEvent' }],
        status: 'applied',
      });
      const row = mockStorage.append.mock.calls[0][0];
      expect(row.actor).toEqual({ kind: 'user', id: '33333333-3333-3333-3333-333333333333' });
    });

    it('leaves actor undefined when no recognizable identity is provided', async () => {
      await service.recordMutation({
        tournamentIds: ['t-1'],
        methods: [{ method: 'addEvent' }],
        status: 'applied',
      });
      const row = mockStorage.append.mock.calls[0][0];
      expect(row.actor).toBeUndefined();
    });

    it('stamps the provisioner actor on DELETE_TOURNAMENT when providerId is set on the caller', async () => {
      await service.recordDeletion({
        tournamentId: 't-1',
        providerId: '44444444-4444-4444-4444-444444444444',
        userId: 'u-admin',
      });
      const row = mockStorage.append.mock.calls[0][0];
      expect(row.actor).toEqual({ kind: 'provider', id: '44444444-4444-4444-4444-444444444444' });
    });
  });

  describe('failure throttling + recovery logging', () => {
    let errorSpy: jest.SpyInstance;
    let warnSpy: jest.SpyInstance;
    let debugSpy: jest.SpyInstance;

    beforeEach(() => {
      // Spy on the Logger prototype so the AuditService instance's
      // logger (constructed in the outer describe's beforeEach) routes
      // calls through these mocks.
      errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    });

    afterEach(() => {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
      debugSpy.mockRestore();
    });

    function failureMessages(spy: jest.SpyInstance): string[] {
      return spy.mock.calls
        .map((c) => c[0])
        .filter((m): m is string => typeof m === 'string' && m.includes('Failed to record MUTATION audit'));
    }

    it('emits ERROR on the 1st and 10th failures and DEBUG in between', async () => {
      mockStorage.append.mockRejectedValue(new Error('DB down'));
      for (let i = 1; i <= 10; i++) {
        await service.recordMutation({
          tournamentIds: ['t-1'],
          methods: [],
          status: 'applied',
        });
      }

      const errors = failureMessages(errorSpy);
      const debugs = failureMessages(debugSpy);
      expect(errors).toHaveLength(2); // counts 1 and 10
      expect(errors[0]).toMatch(/\(1x\)/);
      expect(errors[1]).toMatch(/\(10x\)/);
      expect(debugs).toHaveLength(8); // counts 2..9
    });

    it('emits a WARN recovery line once when an actionType appends successfully after a failure', async () => {
      mockStorage.append.mockRejectedValueOnce(new Error('DB down'));
      await service.recordMutation({ tournamentIds: ['t-1'], methods: [], status: 'applied' });

      mockStorage.append.mockResolvedValueOnce(undefined);
      await service.recordMutation({ tournamentIds: ['t-1'], methods: [], status: 'applied' });

      const recovery = warnSpy.mock.calls
        .map((c) => c[0])
        .filter((m): m is string => typeof m === 'string' && m.includes('recovered after'));
      expect(recovery).toHaveLength(1);
      expect(recovery[0]).toMatch(/MUTATION/);
      expect(recovery[0]).toMatch(/1 failure/);
    });

    it('does not emit a recovery WARN when no prior failure exists', async () => {
      await service.recordMutation({ tournamentIds: ['t-1'], methods: [], status: 'applied' });
      const recovery = warnSpy.mock.calls
        .map((c) => c[0])
        .filter((m): m is string => typeof m === 'string' && m.includes('recovered after'));
      expect(recovery).toHaveLength(0);
    });

    it('resets the per-actionType counter after recovery so the next failure is ERROR again', async () => {
      mockStorage.append.mockRejectedValueOnce(new Error('DB1'));
      await service.recordMutation({ tournamentIds: ['t-1'], methods: [], status: 'applied' });

      mockStorage.append.mockResolvedValueOnce(undefined);
      await service.recordMutation({ tournamentIds: ['t-1'], methods: [], status: 'applied' });

      // Clear spies and fail a third time. Counter should have reset to
      // 0 on recovery; this failure is "1x" again and re-emits ERROR.
      errorSpy.mockClear();
      debugSpy.mockClear();
      mockStorage.append.mockRejectedValueOnce(new Error('DB2'));
      await service.recordMutation({ tournamentIds: ['t-1'], methods: [], status: 'applied' });

      const errors = failureMessages(errorSpy);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/\(1x\)/);
    });
  });

  // Audit failure counter restart persistence (MED, A4). The in-memory
  // failureCounts map is now mirrored to a Postgres side-table so chronic
  // failures don't restart their milestone progression on every deploy.
  describe('failure counter persistence across restarts', () => {
    it('hydrates the in-memory map from loadFailureCounts on module init', async () => {
      mockStorage.loadFailureCounts.mockResolvedValueOnce([
        { actionType: 'MUTATION', count: 7 },
        { actionType: 'DELETE_DRAW', count: 42 },
      ]);

      await service.onModuleInit();

      // Cause MUTATION to fail one more time — the count should advance
      // to 8 (continuing from the hydrated 7), not restart at 1.
      mockStorage.append.mockRejectedValueOnce(new Error('still down'));
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
      try {
        await service.recordMutation({ tournamentIds: ['t-1'], methods: [], status: 'applied' });
        const failureLines = [...errorSpy.mock.calls, ...debugSpy.mock.calls]
          .map((c) => c[0])
          .filter((m): m is string => typeof m === 'string' && m.includes('Failed to record MUTATION audit'));
        expect(failureLines).toHaveLength(1);
        expect(failureLines[0]).toMatch(/\(8x\)/);
      } finally {
        errorSpy.mockRestore();
        debugSpy.mockRestore();
      }
    });

    it('does not throw when loadFailureCounts itself fails on boot', async () => {
      mockStorage.loadFailureCounts.mockRejectedValueOnce(new Error('DB unavailable'));
      await expect(service.onModuleInit()).resolves.not.toThrow();
    });

    it('persists each failure via incrementFailureCount', async () => {
      mockStorage.append.mockRejectedValue(new Error('first failure'));
      await service.recordMutation({ tournamentIds: ['t-1'], methods: [], status: 'applied' });
      // fire-and-forget — let any pending microtasks settle
      await new Promise((r) => setImmediate(r));
      expect(mockStorage.incrementFailureCount).toHaveBeenCalledWith('MUTATION', 'first failure');
    });

    it('clears the persisted counter via clearFailureCount on recovery', async () => {
      mockStorage.append.mockRejectedValueOnce(new Error('fail'));
      await service.recordMutation({ tournamentIds: ['t-1'], methods: [], status: 'applied' });

      mockStorage.append.mockResolvedValueOnce(undefined);
      await service.recordMutation({ tournamentIds: ['t-1'], methods: [], status: 'applied' });
      await new Promise((r) => setImmediate(r));

      expect(mockStorage.clearFailureCount).toHaveBeenCalledWith('MUTATION');
    });

    it('does not crash the recordMutation path when incrementFailureCount throws', async () => {
      mockStorage.append.mockRejectedValue(new Error('audit append failed'));
      mockStorage.incrementFailureCount.mockRejectedValue(new Error('side-table also failed'));
      await expect(
        service.recordMutation({ tournamentIds: ['t-1'], methods: [], status: 'applied' }),
      ).resolves.not.toThrow();
    });
  });
});
