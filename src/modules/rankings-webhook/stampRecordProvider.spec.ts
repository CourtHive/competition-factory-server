import { stampRecordProvider } from './stampRecordProvider';

describe('stampRecordProvider', () => {
  it('stamps the organisation from the provider abbreviation + name', () => {
    const record: any = { tournamentId: 't1' };
    stampRecordProvider(record, { organisationAbbreviation: 'BOBOCA', organisationName: 'Battle of Boca' });
    expect(record.unifiedTournamentId.organisation).toEqual({
      organisationId: 'BOBOCA',
      organisationName: 'Battle of Boca',
    });
  });

  it('falls back to the abbreviation for the organisation name', () => {
    const record: any = {};
    stampRecordProvider(record, { organisationAbbreviation: 'PROV' });
    expect(record.unifiedTournamentId.organisation).toEqual({ organisationId: 'PROV', organisationName: 'PROV' });
  });

  it('is a no-op without a provider abbreviation (no blank scoping)', () => {
    const record: any = { tournamentId: 't1' };
    stampRecordProvider(record, {});
    expect(record.unifiedTournamentId).toBeUndefined();
  });

  it('preserves other unifiedTournamentId fields', () => {
    const record: any = { unifiedTournamentId: { tournamentId: 'x' } };
    stampRecordProvider(record, { organisationAbbreviation: 'A' });
    expect(record.unifiedTournamentId.tournamentId).toEqual('x');
    expect(record.unifiedTournamentId.organisation.organisationId).toEqual('A');
  });
});
