/**
 * Verifies that the public `getParticipants` query honours the owning
 * provider's `participantPrivacy.cityState` cap:
 *  - cap absent / false → addresses stripped (default privacy policy).
 *  - cap true           → city/state present, full street/postal stripped.
 *
 * Uses an in-memory mock for `ITournamentStorage` so the test stays
 * decoupled from filesystem persistence.
 */
import { mocksEngine, tournamentEngine } from 'tods-competition-factory';
import { getParticipants } from './getParticipants';

import type { ITournamentStorage, IProviderStorage } from 'src/storage/interfaces';

const TEST_TID = 'test-participant-privacy-cap';
const TEST_PROVIDER_ID = 'test-privacy-provider';

function buildTournamentWithAddresses() {
  const { tournamentRecord } = mocksEngine.generateTournamentRecord({
    tournamentAttributes: { tournamentId: TEST_TID },
    participantsProfile: { participantsCount: 4 },
    eventProfiles: [{ eventName: 'Singles', drawProfiles: [{ drawSize: 4 }] }],
  });

  // Stamp owning provider so the privacy cap lookup resolves.
  tournamentRecord.parentOrganisation = { organisationId: TEST_PROVIDER_ID };

  // Add city/state to each individual person's address — mocksEngine
  // doesn't synthesise addresses by default.
  for (const participant of tournamentRecord.participants ?? []) {
    if (participant.person) {
      participant.person.addresses = [
        {
          city: 'Austin',
          state: 'TX',
          street: '123 Service Way',
          postalCode: '78701',
        },
      ];
    }
  }

  // Mark participants as published so the public endpoint will serve them.
  tournamentEngine.setState(tournamentRecord);
  tournamentEngine.publishParticipants();
  const publishedRecord = tournamentEngine.getTournament().tournamentRecord;
  publishedRecord.parentOrganisation = { organisationId: TEST_PROVIDER_ID };
  // Re-attach the addresses on the engine-resolved record (publish doesn't
  // strip them — only the public query applies the privacy policy).
  for (const participant of publishedRecord.participants ?? []) {
    const original = tournamentRecord.participants?.find(
      (p: any) => p.participantId === participant.participantId,
    );
    if (original?.person?.addresses) participant.person.addresses = original.person.addresses;
  }

  return publishedRecord;
}

function buildTournamentStorage(record: any): ITournamentStorage {
  return {
    findTournamentRecord: async ({ tournamentId }: any) => {
      if (tournamentId === record.tournamentId) return { tournamentRecord: record };
      return { error: 'NOT_FOUND' };
    },
  } as ITournamentStorage;
}

function buildProviderStorage(participantPrivacy?: { cityState?: boolean }): IProviderStorage {
  return {
    // participantPrivacy is provider-owned and lives on settings, not caps.
    // getProvider returns the persisted shape (providerConfigCaps/Settings),
    // which is what computeEffectiveConfig consumes.
    getProvider: async () => ({ providerConfigCaps: {}, providerConfigSettings: { participantPrivacy } }),
    getProviders: async () => [],
    setProvider: async () => ({ success: true }),
    removeProvider: async () => ({ success: true }),
    updateLastAccess: async () => undefined,
    updateLastAccessByTournament: async () => undefined,
    updateProviderCaps: async () => ({ success: true }),
    updateProviderSettings: async () => ({ success: true }),
  };
}

const AUDIENCE_TID = 'test-public-participants-audience';
const STAFF_ID = 'staff-official-1';
const GROUP_ID = 'group-coach-stable-1';
const ROLELESS_ID = 'roleless-legacy-1';

/**
 * A record carrying every population the public route has to decide about: competitors, a staff
 * INDIVIDUAL, a role-bearing GROUP, and a role-LESS individual.
 *
 * The role-less one is authored directly onto the record because `addParticipant` refuses a
 * participant with no role (`MISSING_PARTICIPANT_ROLE`) — which is exactly why records like it exist
 * only from before that guard, and exactly why they must not be filtered out.
 */
function buildTournamentWithMixedPopulation() {
  const { tournamentRecord } = mocksEngine.generateTournamentRecord({
    tournamentAttributes: { tournamentId: AUDIENCE_TID },
    eventProfiles: [{ eventName: 'Singles', drawProfiles: [{ drawSize: 4 }] }],
    participantsProfile: { participantsCount: 4 },
  });

  const competitors = (tournamentRecord.participants ?? []).filter(
    (p: any) => p.participantType === 'INDIVIDUAL',
  );

  tournamentRecord.participants.push({
    person: { standardGivenName: 'Rhea', standardFamilyName: 'Umpire', personId: 'person-staff-1' },
    participantName: 'Rhea Umpire',
    participantType: 'INDIVIDUAL',
    participantRole: 'OFFICIAL',
    participantId: STAFF_ID,
  });

  tournamentRecord.participants.push({
    individualParticipantIds: competitors.slice(0, 2).map((p: any) => p.participantId),
    participantName: 'Coach Ramirez stable',
    participantType: 'GROUP',
    participantRole: 'COACH',
    participantId: GROUP_ID,
  });

  tournamentRecord.participants.push({
    person: { standardGivenName: 'Legacy', standardFamilyName: 'Record', personId: 'person-legacy-1' },
    participantName: 'Legacy Record',
    participantType: 'INDIVIDUAL',
    participantId: ROLELESS_ID,
    // participantRole deliberately absent
  });

  tournamentEngine.setState(tournamentRecord);
  tournamentEngine.publishParticipants();
  return tournamentEngine.getTournament().tournamentRecord;
}

describe('public getParticipants — only competitors are public', () => {
  let record: any;
  let ids: string[];

  beforeAll(async () => {
    record = buildTournamentWithMixedPopulation();
    const result: any = await getParticipants({ tournamentId: AUDIENCE_TID }, buildTournamentStorage(record));
    ids = result.participants.map((p: any) => p.participantId);
  });

  it('has all four populations on the record — the control, without which the rest is vacuous', () => {
    const onRecord = record.participants.map((p: any) => p.participantId);
    expect(onRecord).toEqual(expect.arrayContaining([STAFF_ID, GROUP_ID, ROLELESS_ID]));
    expect(record.participants.some((p: any) => p.participantRole === 'COMPETITOR')).toBe(true);
  });

  it('EXCLUDES a staff individual', () => {
    // D8: staff belong in tournamentInfo.tournamentContacts, never in the participants payload.
    expect(ids).not.toContain(STAFF_ID);
  });

  it('EXCLUDES a GROUP, which would otherwise publish its member list', () => {
    // Downstream this rendered as a person — courthive-public's Players tab, courthive-arena's roster.
    expect(ids).not.toContain(GROUP_ID);
  });

  it('KEEPS a participant carrying no participantRole at all', () => {
    // The falsification of the trap. `participantRoles: [COMPETITOR]` — the fix as originally written
    // in the plan — is an allow-list that drops this participant, silently shrinking the published
    // list for older tournaments. This assertion fails against that fix and passes against this one.
    expect(ids).toContain(ROLELESS_ID);
  });

  it('KEEPS competitors', () => {
    const competitorIds = record.participants
      .filter((p: any) => p.participantType === 'INDIVIDUAL' && p.participantRole === 'COMPETITOR')
      .map((p: any) => p.participantId);
    expect(competitorIds.length).toBeGreaterThan(0);
    expect(ids).toEqual(expect.arrayContaining(competitorIds));
  });
});

describe('public getParticipants — provider participantPrivacy cap', () => {
  let record: any;

  beforeAll(() => {
    record = buildTournamentWithAddresses();
  });

  it('strips person.addresses when participantPrivacy.cityState is absent', async () => {
    const result: any = await getParticipants(
      { tournamentId: TEST_TID },
      buildTournamentStorage(record),
      buildProviderStorage(),
    );
    expect(result.success).toBe(true);
    expect(Array.isArray(result.participants)).toBe(true);
    for (const p of result.participants) {
      expect(p?.person?.addresses).toBeUndefined();
    }
  });

  it('strips person.addresses when participantPrivacy.cityState is false', async () => {
    const result: any = await getParticipants(
      { tournamentId: TEST_TID },
      buildTournamentStorage(record),
      buildProviderStorage({ cityState: false }),
    );
    expect(result.success).toBe(true);
    for (const p of result.participants) {
      expect(p?.person?.addresses).toBeUndefined();
    }
  });

  it('passes city/state through when participantPrivacy.cityState is true', async () => {
    const result: any = await getParticipants(
      { tournamentId: TEST_TID },
      buildTournamentStorage(record),
      buildProviderStorage({ cityState: true }),
    );
    expect(result.success).toBe(true);

    const addressed = result.participants.filter((p: any) => p?.person?.addresses?.length);
    expect(addressed.length).toBeGreaterThan(0);
    for (const p of addressed) {
      const addr = p.person.addresses[0];
      expect(addr.city).toBe('Austin');
      expect(addr.state).toBe('TX');
      // Full address fields stay stripped — the template only names city/state.
      expect(addr.street).toBeUndefined();
      expect(addr.postalCode).toBeUndefined();
    }
  });

  it('falls back to strict privacy when no providerStorage is supplied', async () => {
    const result: any = await getParticipants(
      { tournamentId: TEST_TID },
      buildTournamentStorage(record),
    );
    expect(result.success).toBe(true);
    for (const p of result.participants) {
      expect(p?.person?.addresses).toBeUndefined();
    }
  });
});
