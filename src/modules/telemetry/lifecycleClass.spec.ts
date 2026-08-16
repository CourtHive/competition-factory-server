import { classifyTournament, LIFECYCLE_CLASS, LIVE_GRACE_DAYS } from './lifecycleClass';

const DAY = 24 * 60 * 60 * 1000;
const at = (iso: string) => Date.parse(`${iso}T12:00:00Z`);

describe('classifyTournament', () => {
  it('classifies a tournament before its start date as construction', () => {
    const record = { startDate: '2026-12-05', endDate: '2026-12-12' };
    expect(classifyTournament(record, at('2026-11-01'))).toBe(LIFECYCLE_CLASS.CONSTRUCTION);
  });

  it('classifies a tournament inside its window as live', () => {
    const record = { startDate: '2026-12-05', endDate: '2026-12-12' };
    expect(classifyTournament(record, at('2026-12-08'))).toBe(LIFECYCLE_CLASS.LIVE);
  });

  it('classifies a tournament well past its end date as archive', () => {
    const record = { startDate: '2026-12-05', endDate: '2026-12-12' };
    expect(classifyTournament(record, at('2027-01-15'))).toBe(LIFECYCLE_CLASS.ARCHIVE);
  });

  it('keeps a tournament live through the grace window after endDate', () => {
    const record = { startDate: '2026-12-05', endDate: '2026-12-12' };
    const justInside = Date.parse('2026-12-12T00:00:00Z') + LIVE_GRACE_DAYS * DAY - 1;
    const justOutside = Date.parse('2026-12-12T00:00:00Z') + LIVE_GRACE_DAYS * DAY + 1;

    // Fail toward live: demoting a tournament that is still being played is a
    // real outage; demoting one late costs only headroom in the wrong pool.
    expect(classifyTournament(record, justInside)).toBe(LIFECYCLE_CLASS.LIVE);
    expect(classifyTournament(record, justOutside)).toBe(LIFECYCLE_CLASS.ARCHIVE);
  });

  it('lets an explicit activeDates entry outrank the start/end window', () => {
    // A tournament whose declared window has closed but which lists today as an
    // active date is being played today — the more specific statement wins.
    const record = { startDate: '2026-12-05', endDate: '2026-12-06', activeDates: ['2026-12-20'] };
    expect(classifyTournament(record, at('2026-12-20'))).toBe(LIFECYCLE_CLASS.LIVE);
  });

  it('ignores activeDates entries for other days', () => {
    const record = { startDate: '2026-12-05', endDate: '2026-12-06', activeDates: ['2026-12-20'] };
    expect(classifyTournament(record, at('2026-12-25'))).toBe(LIFECYCLE_CLASS.ARCHIVE);
  });

  it('returns unknown — never archive — when the record carries no usable dates', () => {
    // Filing an undated record under the pool with the fewest resources is the
    // exact failure this classification exists to surface, so it must not be
    // silently folded into archive.
    expect(classifyTournament({ tournamentId: 't-1' }, at('2026-12-08'))).toBe(LIFECYCLE_CLASS.UNKNOWN);
    expect(classifyTournament({ startDate: 'not-a-date' }, at('2026-12-08'))).toBe(LIFECYCLE_CLASS.UNKNOWN);
    expect(classifyTournament(null, at('2026-12-08'))).toBe(LIFECYCLE_CLASS.UNKNOWN);
  });

  it('handles a record bounded on only one side', () => {
    expect(classifyTournament({ startDate: '2026-12-05' }, at('2026-12-08'))).toBe(LIFECYCLE_CLASS.LIVE);
    expect(classifyTournament({ startDate: '2026-12-05' }, at('2026-11-01'))).toBe(LIFECYCLE_CLASS.CONSTRUCTION);
    expect(classifyTournament({ endDate: '2026-12-12' }, at('2027-06-01'))).toBe(LIFECYCLE_CLASS.ARCHIVE);
  });

  it('is a pure function of the record and the instant', () => {
    const record = { startDate: '2026-12-05', endDate: '2026-12-12' };
    const first = classifyTournament(record, at('2026-12-08'));
    const second = classifyTournament(record, at('2026-12-08'));
    expect(first).toBe(second);
    expect(record).toEqual({ startDate: '2026-12-05', endDate: '2026-12-12' });
  });
});
