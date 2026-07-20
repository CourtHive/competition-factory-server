import { RegistrationsService } from './registrations.service';

jest.mock('../../factory/functions/private/executionQueue', () => ({
  executionQueue: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { executionQueue: mockExecutionQueue } = require('../../factory/functions/private/executionQueue');

describe('RegistrationsService', () => {
  let service: RegistrationsService;
  let tournamentStorageService: any;
  let assignmentsService: any;
  let auditService: any;
  let declarationsClient: any;
  let personsClient: any;

  const NOW = new Date('2026-06-01T12:00:00Z');

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
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

  describe('admin surface (Phase 2-B)', () => {
    const adminUserContext: any = {
      userId: 'admin-uuid',
      email: 'admin@test.com',
      isSuperAdmin: true,
      globalRoles: [],
      providerRoles: {},
      providerIds: [],
    };

    beforeEach(() => {
      mockExecutionQueue.mockReset();
      mockExecutionQueue.mockResolvedValue({ success: true });
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
  });
});
