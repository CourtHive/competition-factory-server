import { refusedAsRolledBack } from './refusedAsRolledBack';

const COURT_NOT_FOUND = { message: 'Court not found', code: 'ERR_NOT_FOUND_COURT' };

describe('refusedAsRolledBack', () => {
  it('returns a successful result unchanged', () => {
    const result = { success: true, results: [{ success: true, methodName: 'setTournamentName' }] };
    expect(refusedAsRolledBack(result)).toBe(result);
  });

  it('drops committed and the directives kept before the refusal, and reports the bulk items rolled back', () => {
    // what a rollback-off engine returns for [rename, deleteCourts([c1, unknown, c3])]
    const items = [
      { index: 0, courtId: 'c1', success: true },
      { index: 1, courtId: 'unknown', error: COURT_NOT_FOUND },
      { index: 2, courtId: 'c3', success: true, warnings: ['w'] },
    ];
    const refusal = { error: COURT_NOT_FOUND, info: 'i', committed: true, results: items };
    const result = {
      ...refusal,
      rolledBack: false,
      results: [
        { success: true, methodName: 'modifyVenue' },
        { ...refusal, methodName: 'deleteCourts' },
      ],
    };
    expect(refusedAsRolledBack(result)).toEqual({
      error: COURT_NOT_FOUND,
      info: 'i',
      rolledBack: true,
      results: [
        { index: 0, courtId: 'c1', rolledBack: true },
        { index: 1, courtId: 'unknown', error: COURT_NOT_FOUND },
        { index: 2, courtId: 'c3', rolledBack: true },
      ],
    });
  });

  it('reports an ordinary refusal rolled back, with no results', () => {
    const result = {
      error: { code: 'ERR_NOT_FOUND_MATCHUP' },
      rolledBack: false,
      results: [{ success: true, methodName: 'setTournamentName' }],
    };
    expect(refusedAsRolledBack(result)).toEqual({ error: { code: 'ERR_NOT_FOUND_MATCHUP' }, rolledBack: true });
  });

  it('reports a refusal the engine already rolled back the same way', () => {
    const result = { error: COURT_NOT_FOUND, rolledBack: true };
    expect(refusedAsRolledBack(result)).toEqual({ error: COURT_NOT_FOUND, rolledBack: true });
  });
});
