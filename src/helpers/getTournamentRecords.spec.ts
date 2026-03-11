import { getTournamentRecords } from './getTournamentRecords';

describe('getTournamentRecords', () => {
  it('returns tournamentRecords when provided directly', () => {
    const records = { t1: { tournamentId: 't1' }, t2: { tournamentId: 't2' } };
    expect(getTournamentRecords({ tournamentRecords: records })).toBe(records);
  });

  it('wraps a single tournamentRecord into a keyed object', () => {
    const record = { tournamentId: 't1', tournamentName: 'Test' };
    const result = getTournamentRecords({ tournamentRecord: record });
    expect(result).toEqual({ t1: record });
  });

  it('prefers tournamentRecords over tournamentRecord', () => {
    const records = { t1: { tournamentId: 't1' } };
    const record = { tournamentId: 't2' };
    expect(getTournamentRecords({ tournamentRecords: records, tournamentRecord: record })).toBe(records);
  });

  it('returns empty object when neither is provided', () => {
    expect(getTournamentRecords({})).toEqual({});
  });

  it('returns empty object for undefined params', () => {
    expect(getTournamentRecords(undefined)).toEqual({});
  });

  it('returns empty object for null params', () => {
    expect(getTournamentRecords(null)).toEqual({});
  });
});
