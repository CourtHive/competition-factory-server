import { configureCompetitionClock, getPinnedCompetitionClock, resetCompetitionClock } from './competitionClockConfig';
import { tools } from 'tods-competition-factory';

// Clock plan slice 0-d.5: a dedicated demo process may pin the factory's clocks; nothing else may.
const PINNED = '2026-05-17T15:30:00.000Z';

describe('configureCompetitionClock', () => {
  afterEach(() => {
    resetCompetitionClock();
  });

  it('does nothing when the variable is unset', () => {
    expect(configureCompetitionClock({})).toEqual({});
    expect(getPinnedCompetitionClock()).toBeUndefined();
  });

  it('pins BOTH factory clocks to one paused instant, and reports it', () => {
    expect(configureCompetitionClock({ COMPETITION_CLOCK_PAUSED_AT: PINNED })).toEqual({ pinnedAt: PINNED });
    expect(tools.competitionNow().toISOString()).toBe(PINNED);
    expect(tools.now().toISOString()).toBe(PINNED);
    expect(getPinnedCompetitionClock()).toBe(PINNED);
  });

  it.each([{ NODE_ENV: 'production' }, { APP_MODE: 'production' }])(
    'refuses to start on a production host: %o',
    (env) => {
      expect(() => configureCompetitionClock({ COMPETITION_CLOCK_PAUSED_AT: PINNED, ...env })).toThrow(/production/);
      expect(getPinnedCompetitionClock()).toBeUndefined();
    },
  );

  it('refuses an unreadable instant rather than running on the wall clock', () => {
    expect(() => configureCompetitionClock({ COMPETITION_CLOCK_PAUSED_AT: 'next tuesday' })).toThrow(/not a readable/);
  });
});
