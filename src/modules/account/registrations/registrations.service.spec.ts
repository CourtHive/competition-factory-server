import { sanctioningEngine, tournamentEngine } from 'tods-competition-factory';

/**
 * The existing-participant stamp rides on factory `addParticipantOtherId`, which is merged
 * (#4620) but NOT yet published. CI installs the published package, so these cases SKIP
 * there and activate automatically on the pin bump — the same probe the service itself
 * uses, deliberately duplicated here rather than imported so a divergence between guard
 * and behaviour shows up as a failure rather than a silent skip.
 */
const stampsExisting = typeof (tournamentEngine as any)?.addParticipantOtherId === 'function';
const itWithStamp = stampsExisting ? it : it.skip;
import {
  foreignSanctionedRegistration,
  ITA_PARTICIPANT_OTHER_ID,
  USTA_PARTICIPANT_OTHER_ID,
} from './foreignIdentity.fixture';

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
      getAssignedRoles: jest.fn().mockResolvedValue(new Map<string, string>()),
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

    // 3d-0 — the participantId is reserved when the person REGISTERS, and accept merely
  // carries it. Precedence is strict: a participant already in the record wins (never
  // create a second one for the same person), then the reservation, then a mint.
  describe('participantId precedence (reserved at registration)', () => {
    function acceptWith(reg: any) {
      declarationsClient.getRegistration.mockResolvedValue(reg);
      personsClient.getById.mockResolvedValue({
        person: { standardGivenName: 'Jane', standardFamilyName: 'Doe' },
      });
      return service.acceptRegistration({
        userContext: adminUserContext,
        tournamentId: 't-1',
        registrationId: 'r-1',
      });
    }

    it('CARRIES the participantId reserved at registration instead of minting', async () => {
      const result = await acceptWith(declarationsReg({ participantId: 'reserved-at-registration' }));
      const participant = mockExecutionQueue.mock.calls[0][0].methods[0].params.participants[0];
      expect(participant.participantId).toBe('reserved-at-registration');
      expect(result.participantId).toBe('reserved-at-registration');
    });

    // Back-compat: registrations predating declarations migration 0004 carry no
    // reservation, and walk-ins never pass through registration at all.
    it('MINTS when the registration carries no reservation', async () => {
      await acceptWith(declarationsReg({ participantId: null }));
      const participant = mockExecutionQueue.mock.calls[0][0].methods[0].params.participants[0];
      expect(participant.participantId).toBeTruthy();
      expect(participant.participantId).not.toBe('reserved-at-registration');
    });

    // The record wins over the reservation — otherwise re-accepting someone already
    // entered would create a SECOND participant for the same person.
    it('prefers a participant ALREADY in the record over the reservation', async () => {
      tournamentStorageService.findTournamentRecord.mockResolvedValue({
        tournamentRecord: {
          ...baseTournament,
          participants: [
            {
              participantId: 'already-in-record',
              participantType: 'INDIVIDUAL',
              person: { personOtherIds: [{ organisationId: 'CANONICAL_PERSON', personId: 'p-canon' }] },
            },
          ],
        },
      });

      const result = await acceptWith(declarationsReg({ participantId: 'reserved-at-registration' }));
      expect(result.participantId).toBe('already-in-record');
      // no addParticipants at all — the person is already there
      const methods = mockExecutionQueue.mock.calls[0][0].methods;
      expect(methods.some((m: any) => m.method === 'addParticipants')).toBe(false);
    });
  });

      // F2b — a registration that originated with an OUTSIDE sanctioning body carries that
      // body's id for the competitor, and accept stamps it onto the participant so results
      // can be addressed back. Every input here is built from the SHARED fixture, so the
      // contract has exactly one description and cannot drift per test.
      describe('foreign sanctioning identity (participantOtherIds)', () => {
        function acceptWith(reg: any) {
          declarationsClient.getRegistration.mockResolvedValue(reg);
          personsClient.getById.mockResolvedValue({
            person: { standardGivenName: 'Jane', standardFamilyName: 'Doe' },
          });
          return service.acceptRegistration({
            userContext: adminUserContext,
            tournamentId: 't-1',
            registrationId: 'r-1',
          });
        }

        function addedParticipant() {
          return mockExecutionQueue.mock.calls[0][0].methods[0].params.participants[0];
        }

        // The other half of F2b: a person ALREADY in the record still has to receive the
        // foreign body's ids, or someone accepted earlier by a self-registration stays
        // permanently unaddressable back to the body that later registered them. This is an
        // UPDATE, so it rides on addParticipantOtherId rather than addParticipants.
        itWithStamp('stamps an existing participant via addParticipantOtherId, not addParticipants', async () => {
          tournamentStorageService.findTournamentRecord.mockResolvedValue({
            tournamentRecord: {
              ...baseTournament,
              participants: [
                {
                  participantId: 'already-in-record',
                  participantType: 'INDIVIDUAL',
                  person: { personOtherIds: [{ organisationId: 'CANONICAL_PERSON', personId: 'p-canon' }] },
                },
              ],
            },
          });

          await acceptWith(
            foreignSanctionedRegistration({}, { participantOtherIds: [ITA_PARTICIPANT_OTHER_ID] }),
          );

          const methods = mockExecutionQueue.mock.calls[0][0].methods;
          expect(methods.some((m: any) => m.method === 'addParticipants')).toBe(false);
          const stamp = methods.find((m: any) => m.method === 'addParticipantOtherId');
          expect(stamp).toBeDefined();
          expect(stamp.params).toMatchObject({
            participantId: 'already-in-record',
            organisationId: 'ITA',
            otherParticipantId: ITA_PARTICIPANT_OTHER_ID.participantId,
          });
        });

        itWithStamp('queues no stamp for an existing participant when no foreign ids were sent', async () => {
          tournamentStorageService.findTournamentRecord.mockResolvedValue({
            tournamentRecord: {
              ...baseTournament,
              participants: [
                {
                  participantId: 'already-in-record',
                  participantType: 'INDIVIDUAL',
                  person: { personOtherIds: [{ organisationId: 'CANONICAL_PERSON', personId: 'p-canon' }] },
                },
              ],
            },
          });

          await acceptWith(foreignSanctionedRegistration());

          const methods = mockExecutionQueue.mock.calls[0][0].methods;
          expect(methods.some((m: any) => m.method === 'addParticipantOtherId')).toBe(false);
        });

        it('stamps the foreign id onto the participant it creates', async () => {
          await acceptWith(
            foreignSanctionedRegistration({}, { participantOtherIds: [ITA_PARTICIPANT_OTHER_ID] }),
          );
          expect(addedParticipant().participantOtherIds).toEqual([ITA_PARTICIPANT_OTHER_ID]);
        });

        it('carries every organisation the registration names, in order', async () => {
          await acceptWith(
            foreignSanctionedRegistration(
              {},
              { participantOtherIds: [ITA_PARTICIPANT_OTHER_ID, USTA_PARTICIPANT_OTHER_ID] },
            ),
          );
          expect(addedParticipant().participantOtherIds.map((o: any) => o.organisationId)).toEqual(['ITA', 'USTA']);
        });

        // An ordinary self-registration must not acquire an empty array — absent means
        // absent, and a stray [] would read as "known to zero organisations" downstream.
        it('omits the attribute entirely for an ordinary self-registration', async () => {
          await acceptWith(foreignSanctionedRegistration());
          expect('participantOtherIds' in addedParticipant()).toBe(false);
        });

        it('omits the attribute when the body sent an empty list', async () => {
          await acceptWith(foreignSanctionedRegistration({}, { participantOtherIds: [] }));
          expect('participantOtherIds' in addedParticipant()).toBe(false);
        });

        // The foreign id is participant-grain and INDEPENDENT of the person-grain link —
        // both must survive, since only one of them can serve a PAIR or TEAM.
        it('does not disturb the CANONICAL_PERSON personOtherIds link', async () => {
          await acceptWith(
            foreignSanctionedRegistration({}, { participantOtherIds: [ITA_PARTICIPANT_OTHER_ID] }),
          );
          const participant = addedParticipant();
          expect(participant.person.personOtherIds).toEqual([
            expect.objectContaining({ organisationId: 'CANONICAL_PERSON', personId: 'p-canon' }),
          ]);
          expect(participant.participantOtherIds).toEqual([ITA_PARTICIPANT_OTHER_ID]);
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
        expect(participant.participantRole).toBe('COMPETITOR'); // required by addParticipants
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
        expect(pair.participantRole).toBe('COMPETITOR');
        expect(pair.individualParticipantIds).toHaveLength(2);
        expect(participants.every((p: any) => p.participantRole === 'COMPETITOR')).toBe(true);
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
