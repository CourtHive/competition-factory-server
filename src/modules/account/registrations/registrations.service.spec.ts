import { sanctioningEngine } from 'tods-competition-factory';

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
  let sanctioningClient: any;

  const NOW = new Date('2026-06-01T12:00:00Z');

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    tournamentStorageService = {
      findTournamentRecord: jest.fn(),
      saveTournamentRecord: jest.fn().mockResolvedValue({ success: true }),
    };
    assignmentsService = {
      getAssignedTournamentIds: jest.fn().mockResolvedValue(new Set<string>()),
    };
    auditService = {
      recordMutation: jest.fn().mockResolvedValue(undefined),
    };
    declarationsClient = {
      getRegistration: jest.fn(),
      listRegistrations: jest.fn().mockResolvedValue([]),
      getPairStatus: jest.fn().mockResolvedValue(null),
      transitionRegistration: jest.fn().mockResolvedValue({ status: 'ACCEPTED' }),
    };
    personsClient = {
      getById: jest.fn().mockResolvedValue(null),
    };
    sanctioningClient = {
      getRecordByTournamentId: jest.fn().mockResolvedValue(null),
    };
    service = new RegistrationsService(
      tournamentStorageService,
      assignmentsService,
      auditService,
      declarationsClient,
      personsClient,
      sanctioningClient,
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
          declarationId: 'r-1',
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

      it('drops + warns on a registered event that resolves to neither eventId nor name', async () => {
        const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
        declarationsClient.getRegistration.mockResolvedValue(
          declarationsReg({ payload: { eventIds: ['e-1', 'ghost-event'], applicant: { givenName: 'Jane', familyName: 'Doe' } } }),
        );
        await service.acceptRegistration({ userContext: adminUserContext, tournamentId: 't-1', registrationId: 'r-1' });
        // 'e-1' resolves by id; 'ghost-event' matches neither id nor name → dropped (only e-1 entered).
        const methods = mockExecutionQueue.mock.calls[0][0].methods;
        expect(methods.slice(1).map((m: any) => m.params.eventId)).toEqual(['e-1']);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ghost-event'));
      });
    });

    describe('lazy-activation on first accept', () => {
      const baseTournament = {
        tournamentId: 't-1',
        parentOrganisation: { organisationId: 'prov-1' },
        events: [{ eventId: 'e-1', eventName: "Men's Singles" }],
      };
      const sanctioningRecord = {
        sanctioningId: 'sanc-1',
        status: 'APPROVED',
        governingBody: { organisationId: 'prov-1' },
        governingBodyId: 'prov-1',
        proposal: { tournamentId: 't-1', events: [{ eventId: 'e-1', eventName: "Men's Singles" }] },
      };
      let activateSpy: jest.SpyInstance;

      beforeEach(() => {
        declarationsClient.getRegistration.mockResolvedValue({
          declarationId: 'r-1',
          personId: 'p-canon',
          providerId: 'prov-1',
          tournamentId: 't-1',
          status: 'SUBMITTED',
          payload: { eventIds: ['e-1'], applicant: { givenName: 'Jane', familyName: 'Doe' } },
          updatedAt: '2026-06-01T00:00:00Z',
        });
        // Keep the sanctioningEngine singleton untouched — only assert it's invoked.
        activateSpy = jest
          .spyOn(sanctioningEngine as any, 'activateFromSanctioning')
          .mockReturnValue({ tournamentRecord: baseTournament });
        jest.spyOn(sanctioningEngine as any, 'reset').mockImplementation(() => undefined);
        jest.spyOn(sanctioningEngine as any, 'setState').mockImplementation(() => undefined);
        jest.spyOn(sanctioningEngine as any, 'setActiveSanctioningId').mockImplementation(() => undefined);
      });

      afterEach(() => jest.restoreAllMocks());

      it('skips activation when the tournamentRecord already exists', async () => {
        tournamentStorageService.findTournamentRecord.mockResolvedValue({ tournamentRecord: baseTournament });
        await service.acceptRegistration({ userContext: adminUserContext, tournamentId: 't-1', registrationId: 'r-1' });
        expect(sanctioningClient.getRecordByTournamentId).not.toHaveBeenCalled();
        expect(tournamentStorageService.saveTournamentRecord).not.toHaveBeenCalled();
      });

      it('does not activate (→ 404) when the record is absent and no proposal exists', async () => {
        tournamentStorageService.findTournamentRecord.mockResolvedValue({ tournamentRecord: null });
        sanctioningClient.getRecordByTournamentId.mockResolvedValue(null);
        await expect(
          service.acceptRegistration({ userContext: adminUserContext, tournamentId: 't-1', registrationId: 'r-1' }),
        ).rejects.toThrow(/Tournament not found/);
        expect(activateSpy).not.toHaveBeenCalled();
      });

      it('activates + persists from the approved proposal on first accept (authorized), then proceeds', async () => {
        tournamentStorageService.findTournamentRecord
          .mockResolvedValueOnce({ tournamentRecord: null }) // ensureActivated: absent
          .mockResolvedValue({ tournamentRecord: baseTournament }); // assertAdminAccess + rest
        sanctioningClient.getRecordByTournamentId.mockResolvedValue(sanctioningRecord);
        personsClient.getById.mockResolvedValue({ person: { standardGivenName: 'Jane', standardFamilyName: 'Doe' } });

        await service.acceptRegistration({ userContext: adminUserContext, tournamentId: 't-1', registrationId: 'r-1' });

        expect(activateSpy).toHaveBeenCalled();
        expect(tournamentStorageService.saveTournamentRecord).toHaveBeenCalledWith(
          expect.objectContaining({ tournamentRecord: baseTournament }),
        );
        expect(mockExecutionQueue).toHaveBeenCalled(); // accept proceeded on the activated record
      });

      it('rejects activation when the caller is not authorised for the proposal provider', async () => {
        tournamentStorageService.findTournamentRecord.mockResolvedValue({ tournamentRecord: null });
        sanctioningClient.getRecordByTournamentId.mockResolvedValue({
          ...sanctioningRecord,
          governingBody: { organisationId: 'other-prov' },
          governingBodyId: 'other-prov',
        });
        const scopedUser = { ...adminUserContext, isSuperAdmin: false, providerIds: ['prov-1'], provisionerProviderIds: [] };
        await expect(
          service.acceptRegistration({ userContext: scopedUser, tournamentId: 't-1', registrationId: 'r-1' }),
        ).rejects.toThrow(/Not authorised to activate/);
        expect(activateSpy).not.toHaveBeenCalled();
        expect(tournamentStorageService.saveTournamentRecord).not.toHaveBeenCalled();
      });
    });

    describe('bulk + pair accept', () => {
      const tournament = {
        tournamentId: 't-1',
        parentOrganisation: { organisationId: 'prov-1' },
        events: [
          { eventId: 'e-ms', eventName: "Men's Singles" },
          { eventId: 'e-md', eventName: "Men's Doubles" },
        ],
        participants: [],
      };
      const reg = (id: string, personId: string, overrides: any = {}) => ({
        declarationId: id,
        personId,
        providerId: 'prov-1',
        tournamentId: 't-1',
        status: 'SUBMITTED',
        payload: { eventIds: ['e-ms'], applicant: { givenName: personId, familyName: 'X' } },
        updatedAt: 't',
        ...overrides,
      });
      const pairStatus = {
        complete: true,
        tournamentId: 't-1',
        event: "Men's Doubles",
        eventId: 'e-md',
        nominatorPersonId: 'p-a',
        inviteePersonId: 'p-b',
      };

      beforeEach(() => {
        tournamentStorageService.findTournamentRecord.mockResolvedValue({ tournamentRecord: tournament });
      });

      it('bulk accepts multiple individuals in a SINGLE executionQueue', async () => {
        declarationsClient.getRegistration.mockImplementation((id: string) => Promise.resolve(reg(id, `person-${id}`)));
        const { results } = await service.acceptMany({ userContext: adminUserContext, tournamentId: 't-1', registrationIds: ['r-1', 'r-2'] });
        expect(mockExecutionQueue).toHaveBeenCalledTimes(1);
        const methods = mockExecutionQueue.mock.calls[0][0].methods;
        expect(methods[0].method).toBe('addParticipants');
        expect(methods[0].params.participants).toHaveLength(2);
        expect(results.every((r: any) => r.ok)).toBe(true);
        expect(declarationsClient.transitionRegistration).toHaveBeenCalledTimes(2);
      });

      it('accepts a complete pair as a PAIR participant, stamping both registrations', async () => {
        const regA = reg('r-1', 'p-a', { payload: { eventIds: ['e-md'], partnerInviteId: 'inv-1', applicant: { givenName: 'A', familyName: 'X' } } });
        const regB = reg('r-2', 'p-b', { payload: { eventIds: ['e-md'], partnerInviteId: 'inv-1', applicant: { givenName: 'B', familyName: 'Y' } } });
        declarationsClient.getRegistration.mockImplementation((id: string) => Promise.resolve(id === 'r-1' ? regA : regB));
        declarationsClient.listRegistrations.mockResolvedValue([regA, regB]);
        declarationsClient.getPairStatus.mockResolvedValue(pairStatus);

        await service.acceptMany({ userContext: adminUserContext, tournamentId: 't-1', registrationIds: ['r-1'] });
        const methods = mockExecutionQueue.mock.calls[0][0].methods;
        const participants = methods[0].params.participants;
        const pair = participants.find((p: any) => p.participantType === 'PAIR');
        expect(pair).toBeDefined();
        expect(pair.individualParticipantIds).toHaveLength(2);
        const doublesEntry = methods.slice(1).find((m: any) => m.params.eventId === 'e-md');
        expect(doublesEntry.params.participantIds).toContain(pair.participantId);
        // Accepting the pair accepts both people — both registrations stamped.
        expect(declarationsClient.transitionRegistration).toHaveBeenCalledTimes(2);
      });

      it('bulk-selecting both halves of a pair creates ONE pair (idempotent) and stamps both', async () => {
        const regA = reg('r-1', 'p-a', { payload: { eventIds: ['e-md'], partnerInviteId: 'inv-1', applicant: { givenName: 'A', familyName: 'X' } } });
        const regB = reg('r-2', 'p-b', { payload: { eventIds: ['e-md'], partnerInviteId: 'inv-1', applicant: { givenName: 'B', familyName: 'Y' } } });
        declarationsClient.getRegistration.mockImplementation((id: string) => Promise.resolve(id === 'r-1' ? regA : regB));
        declarationsClient.listRegistrations.mockResolvedValue([regA, regB]);
        declarationsClient.getPairStatus.mockResolvedValue(pairStatus);

        await service.acceptMany({ userContext: adminUserContext, tournamentId: 't-1', registrationIds: ['r-1', 'r-2'] });
        expect(mockExecutionQueue).toHaveBeenCalledTimes(1);
        const participants = mockExecutionQueue.mock.calls[0][0].methods[0].params.participants;
        expect(participants.filter((p: any) => p.participantType === 'PAIR')).toHaveLength(1);
        expect(participants.filter((p: any) => p.participantType === 'INDIVIDUAL')).toHaveLength(2);
        expect(declarationsClient.transitionRegistration).toHaveBeenCalledTimes(2);
      });
    });
  });
});
