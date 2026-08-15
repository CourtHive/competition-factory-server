import { RegistrationSnapshot, RegistrationParticipantOtherId } from '../declarations/declarations-client.service';

/**
 * THE CONTRACT for a foreign sanctioning body's participant identity arriving on a
 * registration — in one place, on purpose.
 *
 * A sanction taken from an outside body means results eventually have to be handed back to
 * it, and that is only possible if we carry an id it recognises. `personOtherIds` covers an
 * INDIVIDUAL, but a PAIR or TEAM participant has no `person` at all, so the id rides on
 * `participantOtherIds` (see factory `UnifiedParticipantID`).
 *
 * **Why a shared fixture rather than an inline literal per test.** Every consumer test
 * builds its input from here, so there is exactly one description of the shape. Hand-rolled
 * per-test mocks are the mock-divergence failure class: the real producer sends something
 * slightly different, every test still passes, and the gap only appears in production.
 * Changing the contract has to happen here, which makes the blast radius visible.
 *
 * The producer side is guarded separately — courthive-declarations asserts that an unknown
 * payload key survives `apply()` untouched, which is the assumption this whole path rests
 * on. If someone tightens `validateRegistrationPayload` into an allow-list, that test fails
 * rather than this one silently continuing to pass against a mock.
 */
export const ITA_PARTICIPANT_OTHER_ID: RegistrationParticipantOtherId = {
  organisationId: 'ITA',
  uniqueOrganisationName: 'Intercollegiate Tennis Association',
  participantId: 'ita-entry-771',
};

export const USTA_PARTICIPANT_OTHER_ID: RegistrationParticipantOtherId = {
  organisationId: 'USTA',
  participantId: 'usta-entry-3',
};

/**
 * A registration snapshot as CFS receives it from courthive-declarations.
 *
 * Defaults describe the ORDINARY case — a person self-registering, no foreign body
 * involved, so no `participantOtherIds`. Pass them explicitly to describe a registration
 * that originated with an outside sanctioning body; that asymmetry is deliberate, so a test
 * that does not mention foreign identity cannot accidentally depend on it.
 */
export function foreignSanctionedRegistration(
  overrides: Partial<RegistrationSnapshot> = {},
  payloadOverrides: Partial<RegistrationSnapshot['payload']> = {},
): RegistrationSnapshot {
  return {
    declarationId: 'r-1',
    personId: 'p-canon',
    providerId: 'prov-1',
    tournamentId: 't-1',
    status: 'SUBMITTED',
    participantId: null,
    updatedAt: '2026-06-01T00:00:00Z',
    ...overrides,
    payload: {
      eventIds: ["Men's Singles"],
      applicant: { givenName: 'Jane', familyName: 'Doe' },
      ...payloadOverrides,
    },
  };
}
