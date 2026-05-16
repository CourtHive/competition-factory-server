import { FederationDataAdapter, FEDERATION_ADAPTERS } from './FederationDataAdapter';
import { FederationDataService } from './federation-data.service';

// Hand-rolled stubs (mirroring the suite's other lightweight service specs)
// — a full TestingModule wires too many transitive providers for what is a
// dispatch-logic unit test.

class FakeAdapter implements FederationDataAdapter {
  readonly provider = 'FAKE';
  readonly organizationId = '00000000-0000-0000-0000-000000000000';
  constructor(private readonly handles: (s: string) => boolean) {}
  canHandle(identifier: string): boolean {
    return this.handles(identifier);
  }
  async fetchTournament(identifier: string) {
    return { tournamentId: 'FAKE-1', tournamentName: 'Fake Cup', sourceIdentifier: identifier } as any;
  }
}

const calendarStorageStub: any = {
  getCalendar: async () => ({ tournaments: [] }),
};
const tournamentStorageStub: any = {
  saveTournamentRecord: async () => undefined,
};

function build(adapters: FederationDataAdapter[]) {
  return new FederationDataService(adapters, tournamentStorageStub, calendarStorageStub);
}

describe('FederationDataService dispatcher', () => {
  it('rejects non-string identifier', async () => {
    const svc = build([new FakeAdapter(() => true)]);
    const result = await svc.fetchTournamentDetails({ identifier: 123 as unknown as string });
    expect(result).toEqual({ error: 'Invalid parameters' });
  });

  it('returns NO_ADAPTER_FOR_IDENTIFIER when no adapter matches', async () => {
    const svc = build([new FakeAdapter(() => false)]);
    const result = await svc.fetchTournamentDetails({ identifier: 'https://example.com/nothing' });
    expect(result).toEqual({ error: 'NO_ADAPTER_FOR_IDENTIFIER' });
  });

  it('delegates to the first matching adapter and saves a new tournament', async () => {
    const saved: any[] = [];
    const storage: any = { saveTournamentRecord: async ({ tournamentRecord }) => saved.push(tournamentRecord) };
    const svc = new FederationDataService([new FakeAdapter(() => true)], storage, calendarStorageStub);
    const result: any = await svc.fetchTournamentDetails({ identifier: 'https://example.com/x' });
    expect(result.success).toBe(true);
    expect(result.tournamentRecord.tournamentId).toBe('FAKE-1');
    expect(saved).toHaveLength(1);
  });

  it('does not re-save a tournament already in the provider calendar', async () => {
    const saved: any[] = [];
    const storage: any = { saveTournamentRecord: async ({ tournamentRecord }) => saved.push(tournamentRecord) };
    const calendar: any = { getCalendar: async () => ({ tournaments: [{ tournamentId: 'FAKE-1' }] }) };
    const svc = new FederationDataService([new FakeAdapter(() => true)], storage, calendar);
    const result: any = await svc.fetchTournamentDetails({ identifier: 'https://example.com/x' });
    expect(result.success).toBe(true);
    expect(saved).toHaveLength(0);
  });

  it('picks the first canHandle match in registration order', async () => {
    const a1 = new FakeAdapter((s) => s.includes('one'));
    const a2 = new FakeAdapter((s) => s.includes('two'));
    const svc = build([a1, a2]);
    const r1: any = await svc.fetchTournamentDetails({ identifier: 'https://x/one' });
    const r2: any = await svc.fetchTournamentDetails({ identifier: 'https://x/two' });
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
  });

  it('FEDERATION_ADAPTERS DI token is stable', () => {
    expect(FEDERATION_ADAPTERS).toBe('FEDERATION_ADAPTERS');
  });
});
