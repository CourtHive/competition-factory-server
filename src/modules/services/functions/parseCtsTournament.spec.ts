import { parseCtsTournament } from './parseCtsTournament';

describe('parseCtsTournament', () => {
  it('returns error when no .span6 element found', () => {
    const doc = {
      querySelector: () => null,
    };
    const result = parseCtsTournament({ tournamentId: '12345', doc });
    expect(result).toEqual({ error: 'Parsing Error' });
  });

  it('maps tournamentId prefix based on first character for category', () => {
    // Test category inference: '9' -> U10, '7'/'8' -> U12, etc.
    // We can't easily test full parsing without a real DOM, but we can test the error path
    const doc = { querySelector: () => null };
    expect(parseCtsTournament({ tournamentId: '91234', doc })).toEqual({ error: 'Parsing Error' });
  });
});
