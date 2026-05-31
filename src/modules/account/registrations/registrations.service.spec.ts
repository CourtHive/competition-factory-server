import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';

import { RegistrationsService } from './registrations.service';

jest.mock('../../factory/functions/private/executionQueue', () => ({
  executionQueue: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { executionQueue: mockExecutionQueue } = require('../../factory/functions/private/executionQueue');

describe('RegistrationsService', () => {
  let service: RegistrationsService;
  let storage: any;
  let userStorage: any;
  let tournamentStorageService: any;
  let assignmentsService: any;
  let auditService: any;

  const NOW = new Date('2026-06-01T12:00:00Z');
  const OPEN_PROFILE = {
    entriesOpen: '2026-05-01T00:00:00Z',
    entriesClose: '2026-06-10T00:00:00Z',
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    storage = {
      applyForTournament: jest.fn(),
      findById: jest.fn(),
      listByUser: jest.fn(),
      listByTournament: jest.fn(),
      updateStatus: jest.fn(),
      linkParticipant: jest.fn(),
    };
    userStorage = {
      getPersonLink: jest.fn().mockResolvedValue(null),
      findByUserId: jest.fn().mockResolvedValue(null),
    };
    tournamentStorageService = {
      findTournamentRecord: jest.fn(),
    };
    assignmentsService = {
      getAssignedTournamentIds: jest.fn().mockResolvedValue(new Set<string>()),
    };
    auditService = {
      recordMutation: jest.fn().mockResolvedValue(undefined),
    };
    service = new RegistrationsService(
      storage,
      userStorage,
      tournamentStorageService,
      assignmentsService,
      auditService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('apply', () => {
    it('rejects without userId', async () => {
      await expect(
        service.apply({ userId: '', tournamentId: 't-1' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects without tournamentId', async () => {
      await expect(
        service.apply({ userId: 'u-1', tournamentId: '' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when the tournament is not found', async () => {
      tournamentStorageService.findTournamentRecord.mockResolvedValue({ tournamentRecord: null });
      await expect(
        service.apply({ userId: 'u-1', tournamentId: 't-1' }),
      ).rejects.toThrow(/Tournament not found/);
    });

    it('rejects when no registrationProfile is published', async () => {
      tournamentStorageService.findTournamentRecord.mockResolvedValue({
        tournamentRecord: { tournamentId: 't-1' },
      });
      await expect(
        service.apply({ userId: 'u-1', tournamentId: 't-1' }),
      ).rejects.toThrow(/registration window/);
    });

    it('rejects when entries are closed', async () => {
      tournamentStorageService.findTournamentRecord.mockResolvedValue({
        tournamentRecord: {
          tournamentId: 't-1',
          registrationProfile: { entriesOpen: '2026-04-01', entriesClose: '2026-05-30T00:00:00Z' },
          events: [],
        },
      });
      await expect(
        service.apply({ userId: 'u-1', tournamentId: 't-1' }),
      ).rejects.toThrow(/closed/);
    });

    it('rejects when entries have not opened yet', async () => {
      tournamentStorageService.findTournamentRecord.mockResolvedValue({
        tournamentRecord: {
          tournamentId: 't-1',
          registrationProfile: { entriesOpen: '2026-08-01T00:00:00Z' },
          events: [],
        },
      });
      await expect(
        service.apply({ userId: 'u-1', tournamentId: 't-1' }),
      ).rejects.toThrow(/have not opened/);
    });

    it('upserts via storage with the HiveID personId attached when linked', async () => {
      tournamentStorageService.findTournamentRecord.mockResolvedValue({
        tournamentRecord: {
          tournamentId: 't-1',
          registrationProfile: OPEN_PROFILE,
          events: [{ eventId: 'e-1' }, { eventId: 'e-2' }],
        },
      });
      userStorage.getPersonLink.mockResolvedValue({
        userId: 'u-1',
        personId: 'p-canon',
        personRevision: 1,
        cached: {},
        consentPreferences: {},
      });
      storage.applyForTournament.mockResolvedValue({ registrationId: 'r-1' });

      await service.apply({
        userId: 'u-1',
        tournamentId: 't-1',
        eventIds: ['e-1', 'e-2', 'unknown-event'],
        partnerUserId: 'u-2',
        answers: { handedness: 'right' },
      });

      expect(storage.applyForTournament).toHaveBeenCalledWith({
        tournamentId: 't-1',
        userId: 'u-1',
        personId: 'p-canon',
        eventIds: ['e-1', 'e-2'],
        partnerUserId: 'u-2',
        answers: { handedness: 'right' },
      });
    });

    it('passes a null personId when the user has no canonical link', async () => {
      tournamentStorageService.findTournamentRecord.mockResolvedValue({
        tournamentRecord: { tournamentId: 't-1', registrationProfile: OPEN_PROFILE, events: [] },
      });
      storage.applyForTournament.mockResolvedValue({ registrationId: 'r-1' });
      await service.apply({ userId: 'u-1', tournamentId: 't-1' });
      const call = storage.applyForTournament.mock.calls[0][0];
      expect(call.personId).toBeNull();
    });
  });

  describe('listForUser', () => {
    it('rejects without userId', async () => {
      await expect(service.listForUser('')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('returns the storage list', async () => {
      storage.listByUser.mockResolvedValue([{ registrationId: 'r-1' }]);
      const result = await service.listForUser('u-1');
      expect(result).toEqual([{ registrationId: 'r-1' }]);
      expect(storage.listByUser).toHaveBeenCalledWith('u-1');
    });
  });

  describe('withdraw', () => {
    it('rejects on missing args', async () => {
      await expect(service.withdraw('', 'r-1')).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(service.withdraw('u-1', '')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when the registration belongs to a different user', async () => {
      storage.findById.mockResolvedValue({ registrationId: 'r-1', userId: 'someone-else', status: 'applied' });
      await expect(service.withdraw('u-1', 'r-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('idempotently returns the row when already withdrawn', async () => {
      const existing = { registrationId: 'r-1', userId: 'u-1', status: 'withdrawn' };
      storage.findById.mockResolvedValue(existing);
      const result = await service.withdraw('u-1', 'r-1');
      expect(result).toBe(existing);
      expect(storage.updateStatus).not.toHaveBeenCalled();
    });

    it('calls updateStatus with the applicant-initiated reason', async () => {
      storage.findById.mockResolvedValue({ registrationId: 'r-1', userId: 'u-1', status: 'applied' });
      storage.updateStatus.mockResolvedValue({ registrationId: 'r-1', status: 'withdrawn' });
      const result = await service.withdraw('u-1', 'r-1');
      expect(storage.updateStatus).toHaveBeenCalledWith({
        registrationId: 'r-1',
        status: 'withdrawn',
        decidedByUserId: 'u-1',
        statusReason: 'applicant-initiated',
      });
      expect(result.status).toBe('withdrawn');
    });
  });

  describe('admin surface (Phase 2-B)', () => {
    const adminUserContext: any = {
      userId: 'admin-uuid',
      email: 'admin@test.com',
      isSuperAdmin: true,
      globalRoles: [],
      providerRoles: {},
      providerIds: [],
    };
    const nonAdminUserContext: any = {
      userId: 'random-uuid',
      email: 'rando@test.com',
      isSuperAdmin: false,
      globalRoles: [],
      providerRoles: {},
      providerIds: [],
    };

    beforeEach(() => {
      mockExecutionQueue.mockReset();
      mockExecutionQueue.mockResolvedValue({ success: true });
    });

    describe('listForTournament', () => {
      it('rejects unauthorised callers', async () => {
        tournamentStorageService.findTournamentRecord.mockResolvedValue({
          tournamentRecord: { tournamentId: 't-1', parentOrganisation: { organisationId: 'prov-99' } },
        });
        await expect(
          service.listForTournament(nonAdminUserContext, 't-1'),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });

      it('returns rows filtered by status when requested', async () => {
        tournamentStorageService.findTournamentRecord.mockResolvedValue({
          tournamentRecord: { tournamentId: 't-1', parentOrganisation: { organisationId: 'prov-1' } },
        });
        storage.listByTournament.mockResolvedValue([
          { registrationId: 'r-1', status: 'applied' },
          { registrationId: 'r-2', status: 'accepted' },
          { registrationId: 'r-3', status: 'applied' },
        ]);
        const result = await service.listForTournament(adminUserContext, 't-1', 'applied');
        expect(result.map((r) => r.registrationId)).toEqual(['r-1', 'r-3']);
      });
    });

    describe('acceptRegistration', () => {
      const baseTournament = {
        tournamentId: 't-1',
        parentOrganisation: { organisationId: 'prov-1' },
        events: [{ eventId: 'e-1' }, { eventId: 'e-2' }],
      };

      beforeEach(() => {
        tournamentStorageService.findTournamentRecord.mockResolvedValue({
          tournamentRecord: baseTournament,
        });
      });

      it('rejects when applicant has no canonical name', async () => {
        storage.findById.mockResolvedValue({
          registrationId: 'r-1',
          tournamentId: 't-1',
          userId: 'u-1',
          status: 'applied',
          eventIds: ['e-1'],
        });
        userStorage.getPersonLink.mockResolvedValue(null);
        userStorage.findByUserId.mockResolvedValue({ userId: 'u-1' });
        await expect(
          service.acceptRegistration({
            userContext: adminUserContext,
            tournamentId: 't-1',
            registrationId: 'r-1',
          }),
        ).rejects.toThrow(/canonical name/);
      });

      it('rejects when the registration is already in a terminal state', async () => {
        storage.findById.mockResolvedValue({
          registrationId: 'r-1',
          tournamentId: 't-1',
          status: 'rejected',
        });
        await expect(
          service.acceptRegistration({
            userContext: adminUserContext,
            tournamentId: 't-1',
            registrationId: 'r-1',
          }),
        ).rejects.toThrow(/terminal/);
      });

      it('stamps CANONICAL_PERSON on personOtherIds when applicant is linked, and links the new participantId', async () => {
        storage.findById.mockResolvedValue({
          registrationId: 'r-1',
          tournamentId: 't-1',
          userId: 'u-1',
          status: 'applied',
          eventIds: ['e-1', 'e-2'],
        });
        userStorage.getPersonLink.mockResolvedValue({
          userId: 'u-1',
          personId: 'p-canon',
          personRevision: 1,
          cached: {
            standardFamilyName: 'Doe',
            standardGivenName: 'Jane',
            birthDate: '1990-04-12',
            sex: 'F',
            nationalityCode: 'USA',
          },
          consentPreferences: {},
        });
        userStorage.findByUserId.mockResolvedValue({ userId: 'u-1', firstName: 'Jane', lastName: 'Doe' });
        storage.linkParticipant.mockResolvedValue({ registrationId: 'r-1', status: 'accepted' });

        const result = await service.acceptRegistration({
          userContext: adminUserContext,
          tournamentId: 't-1',
          registrationId: 'r-1',
        });

        expect(mockExecutionQueue).toHaveBeenCalledTimes(1);
        const args = mockExecutionQueue.mock.calls[0][0];
        expect(args.tournamentIds).toEqual(['t-1']);
        const methods = args.methods;
        expect(methods[0].method).toBe('addParticipants');
        const participant = methods[0].params.participants[0];
        expect(participant.person.standardGivenName).toBe('Jane');
        expect(participant.person.standardFamilyName).toBe('Doe');
        expect(participant.person.personOtherIds).toEqual([
          expect.objectContaining({ organisationId: 'CANONICAL_PERSON', personId: 'p-canon' }),
        ]);
        // Subsequent methods enter each picked event with DIRECT_ACCEPTANCE.
        expect(methods.slice(1).map((m: any) => m.method)).toEqual(['addEventEntries', 'addEventEntries']);
        expect(methods.slice(1).every((m: any) => m.params.entryStatus === 'DIRECT_ACCEPTANCE')).toBe(true);

        expect(storage.linkParticipant).toHaveBeenCalledWith(
          expect.objectContaining({
            registrationId: 'r-1',
            participantId: participant.participantId,
            decidedByUserId: 'admin-uuid',
          }),
        );
        expect(result.participantId).toBe(participant.participantId);
      });

      it('passes an empty personOtherIds when applicant has no canonical link', async () => {
        storage.findById.mockResolvedValue({
          registrationId: 'r-1',
          tournamentId: 't-1',
          userId: 'u-1',
          status: 'applied',
          eventIds: [],
        });
        userStorage.getPersonLink.mockResolvedValue({
          userId: 'u-1',
          personId: null,
          personRevision: null,
          cached: {
            standardFamilyName: 'Doe',
            standardGivenName: 'Jane',
            birthDate: null,
            sex: null,
            nationalityCode: null,
          },
          consentPreferences: {},
        });
        userStorage.findByUserId.mockResolvedValue({ userId: 'u-1', firstName: 'Jane', lastName: 'Doe' });
        storage.linkParticipant.mockResolvedValue({ registrationId: 'r-1', status: 'accepted' });

        await service.acceptRegistration({
          userContext: adminUserContext,
          tournamentId: 't-1',
          registrationId: 'r-1',
        });
        const participant = mockExecutionQueue.mock.calls[0][0].methods[0].params.participants[0];
        expect(participant.person.personOtherIds).toEqual([]);
      });

      it('throws when the factory mutation fails (no status flip)', async () => {
        storage.findById.mockResolvedValue({
          registrationId: 'r-1',
          tournamentId: 't-1',
          userId: 'u-1',
          status: 'applied',
          eventIds: [],
        });
        userStorage.getPersonLink.mockResolvedValue({
          userId: 'u-1',
          personId: 'p-canon',
          cached: { standardFamilyName: 'Doe', standardGivenName: 'Jane', birthDate: null, sex: null, nationalityCode: null },
          consentPreferences: {},
        });
        userStorage.findByUserId.mockResolvedValue({ userId: 'u-1', firstName: 'Jane', lastName: 'Doe' });
        mockExecutionQueue.mockResolvedValue({ error: 'duplicate participant' });
        await expect(
          service.acceptRegistration({
            userContext: adminUserContext,
            tournamentId: 't-1',
            registrationId: 'r-1',
          }),
        ).rejects.toThrow(/duplicate participant/);
        expect(storage.linkParticipant).not.toHaveBeenCalled();
      });
    });

    describe('waitlistRegistration', () => {
      it('updates status to waitlisted', async () => {
        tournamentStorageService.findTournamentRecord.mockResolvedValue({
          tournamentRecord: { tournamentId: 't-1', parentOrganisation: { organisationId: 'prov-1' } },
        });
        storage.findById.mockResolvedValue({
          registrationId: 'r-1',
          tournamentId: 't-1',
          status: 'applied',
        });
        storage.updateStatus.mockResolvedValue({ registrationId: 'r-1', status: 'waitlisted' });
        const result = await service.waitlistRegistration({
          userContext: adminUserContext,
          tournamentId: 't-1',
          registrationId: 'r-1',
          statusReason: 'over capacity',
        });
        expect(result.status).toBe('waitlisted');
        expect(storage.updateStatus).toHaveBeenCalledWith({
          registrationId: 'r-1',
          status: 'waitlisted',
          decidedByUserId: 'admin-uuid',
          statusReason: 'over capacity',
        });
      });
    });

    describe('rejectRegistration', () => {
      it('updates status to rejected', async () => {
        tournamentStorageService.findTournamentRecord.mockResolvedValue({
          tournamentRecord: { tournamentId: 't-1', parentOrganisation: { organisationId: 'prov-1' } },
        });
        storage.findById.mockResolvedValue({
          registrationId: 'r-1',
          tournamentId: 't-1',
          status: 'applied',
        });
        storage.updateStatus.mockResolvedValue({ registrationId: 'r-1', status: 'rejected' });
        const result = await service.rejectRegistration({
          userContext: adminUserContext,
          tournamentId: 't-1',
          registrationId: 'r-1',
        });
        expect(result.status).toBe('rejected');
      });
    });

    describe('bulkAction', () => {
      it('runs each action and aggregates per-row results', async () => {
        tournamentStorageService.findTournamentRecord.mockResolvedValue({
          tournamentRecord: { tournamentId: 't-1', parentOrganisation: { organisationId: 'prov-1' } },
        });
        storage.findById.mockImplementation((id: string) => {
          if (id === 'r-1') return Promise.resolve({ registrationId: 'r-1', tournamentId: 't-1', status: 'applied' });
          if (id === 'r-2') return Promise.resolve({ registrationId: 'r-2', tournamentId: 't-1', status: 'rejected' });
          return Promise.resolve(null);
        });
        storage.updateStatus.mockResolvedValue({ registrationId: 'r-1', status: 'rejected' });

        const result = await service.bulkAction({
          userContext: adminUserContext,
          tournamentId: 't-1',
          action: 'reject',
          registrationIds: ['r-1', 'r-2', 'missing'],
        });
        expect(result.results).toHaveLength(3);
        expect(result.results[0]).toMatchObject({ registrationId: 'r-1', ok: true });
        expect(result.results[1].ok).toBe(false);
        expect(result.results[2].ok).toBe(false);
      });
    });
  });
});
