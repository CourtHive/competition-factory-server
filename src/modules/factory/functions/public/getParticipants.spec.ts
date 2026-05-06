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
    getProvider: async () => ({ caps: { participantPrivacy }, settings: {} }),
    getProviders: async () => [],
    setProvider: async () => ({ success: true }),
    removeProvider: async () => ({ success: true }),
    updateLastAccess: async () => undefined,
    updateLastAccessByTournament: async () => undefined,
    updateProviderCaps: async () => ({ success: true }),
    updateProviderSettings: async () => ({ success: true }),
  };
}

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
