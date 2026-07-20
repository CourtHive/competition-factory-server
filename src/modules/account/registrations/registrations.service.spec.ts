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
  let declarationsClient: any;
  let personsClient: any;

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
    declarationsClient = {
      getRegistration: jest.fn(),
      transitionRegistration: jest.fn().mockResolvedValue({ status: 'ACCEPTED' }),
    };
    personsClient = {
      getById: jest.fn().mockResolvedValue(null),
    };
    service = new RegistrationsService(
      storage,
      userStorage,
      tournamentStorageService,
      assignmentsService,
      auditService,
      declarationsClient,
      personsClient,
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
        events: [
          { eventId: 'e-1', eventName: "Men's Singles" },
          { eventId: 'e-2', eventName: "Women's Singles" },
        ],
      };

      function declarationsReg(overrides: any = {}) {
        return {
          personId: 'p-canon',
          providerId: 'prov-1',
          tournamentId: 't-1',
          status: 'SUBMITTED',
          payload: { eventIds: ["Men's Singles"], applicant: { givenName: 'Jane', familyName: 'Doe' } },
          updatedAt: '2026-06-01T00:00:00Z',
          ...overrides,
        };
      }

      beforeEach(() => {
        tournamentStorageService.findTournamentRecord.mockResolvedValue({
          tournamentRecord: baseTournament,
        });
      });

      it('rejects when applicant has no canonical name (nothing to name the participant)', async () => {
        declarationsClient.getRegistration.mockResolvedValue(declarationsReg({ payload: { eventIds: [] } }));
        personsClient.getById.mockResolvedValue(null);
        await expect(
          service.acceptRegistration({ userContext: adminUserContext, tournamentId: 't-1', registrationId: 'r-1' }),
        ).rejects.toThrow(/canonical name/);
      });

      it('rejects when the registration is already decided (not SUBMITTED/WAITLISTED)', async () => {
        declarationsClient.getRegistration.mockResolvedValue(declarationsReg({ status: 'REJECTED' }));
        await expect(
          service.acceptRegistration({ userContext: adminUserContext, tournamentId: 't-1', registrationId: 'r-1' }),
        ).rejects.toThrow(/not acceptable/);
      });

      it('rejects when the registration is not found', async () => {
        declarationsClient.getRegistration.mockResolvedValue(null);
        await expect(
          service.acceptRegistration({ userContext: adminUserContext, tournamentId: 't-1', registrationId: 'r-1' }),
        ).rejects.toThrow(/not found/);
      });

      it('adds the participant (CANONICAL_PERSON), maps event NAMES → eventIds, and stamps ACCEPTED', async () => {
        declarationsClient.getRegistration.mockResolvedValue(
          declarationsReg({ payload: { eventIds: ["Men's Singles", 'e-2'], applicant: { givenName: 'Jane', familyName: 'Doe' } } }),
        );
        personsClient.getById.mockResolvedValue({
          person: { standardGivenName: 'Jane', standardFamilyName: 'Doe', birthDate: '1990-04-12', sex: 'F', nationalityCode: 'USA' },
        });

        const result = await service.acceptRegistration({
          userContext: adminUserContext,
          tournamentId: 't-1',
          registrationId: 'r-1',
        });

        expect(mockExecutionQueue).toHaveBeenCalledTimes(1);
        const methods = mockExecutionQueue.mock.calls[0][0].methods;
        expect(methods[0].method).toBe('addParticipants');
        const participant = methods[0].params.participants[0];
        expect(participant.person.standardGivenName).toBe('Jane');
        expect(participant.person.personOtherIds).toEqual([
          expect.objectContaining({ organisationId: 'CANONICAL_PERSON', personId: 'p-canon' }),
        ]);
        // Event name + eventId both resolve to activated eventIds, entered DIRECT_ACCEPTANCE.
        expect(methods.slice(1).map((m: any) => m.params.eventId)).toEqual(['e-1', 'e-2']);
        expect(methods.slice(1).every((m: any) => m.params.entryStatus === 'DIRECT_ACCEPTANCE')).toBe(true);

        // Status is stamped in declarations, NOT in CFS storage.
        expect(declarationsClient.transitionRegistration).toHaveBeenCalledWith(
          expect.objectContaining({ declarationId: 'r-1', toStatus: 'ACCEPTED', transitionedBy: 'admin-uuid' }),
        );
        expect(storage.linkParticipant).not.toHaveBeenCalled();
        expect(result.participantId).toBe(participant.participantId);
        expect(result.registration.status).toBe('accepted');
      });

      it('falls back to the denormalized applicant name when persons is unavailable', async () => {
        declarationsClient.getRegistration.mockResolvedValue(declarationsReg());
        personsClient.getById.mockRejectedValue(new Error('persons down'));
        await service.acceptRegistration({ userContext: adminUserContext, tournamentId: 't-1', registrationId: 'r-1' });
        const participant = mockExecutionQueue.mock.calls[0][0].methods[0].params.participants[0];
        expect(participant.participantName).toBe('Jane Doe');
      });

      it('throws when the factory mutation fails and does not stamp ACCEPTED', async () => {
        declarationsClient.getRegistration.mockResolvedValue(declarationsReg({ payload: { eventIds: [], applicant: { givenName: 'Jane', familyName: 'Doe' } } }));
        mockExecutionQueue.mockResolvedValue({ error: 'duplicate participant' });
        await expect(
          service.acceptRegistration({ userContext: adminUserContext, tournamentId: 't-1', registrationId: 'r-1' }),
        ).rejects.toThrow(/duplicate participant/);
        expect(declarationsClient.transitionRegistration).not.toHaveBeenCalled();
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
