import { selectPrivacyApplyTargets } from './selectPrivacyApplyTargets';

const today = '2026-07-03';

function cal(id: string, startDate: string, endDate: string) {
  return { tournamentId: id, tournament: { startDate, endDate } };
}

const calendar = [
  cal('past', '2026-06-01', '2026-06-10'), // completed
  cal('ends-yesterday', '2026-06-20', '2026-07-02'), // completed (endDate < today)
  cal('live', '2026-07-01', '2026-07-05'), // in progress (start <= today <= end)
  cal('starts-today', '2026-07-03', '2026-07-08'), // in progress (start == today)
  cal('ends-today', '2026-06-30', '2026-07-03'), // in progress (end == today)
  cal('future', '2026-08-01', '2026-08-05'), // upcoming
];

describe('selectPrivacyApplyTargets', () => {
  it('selects upcoming only by default (never completed, never in-progress)', () => {
    const r = selectPrivacyApplyTargets(calendar, { includeInProgress: false, today });
    expect(r.selected).toEqual(['future']);
    expect(r.upcoming).toEqual(['future']);
    expect(r.inProgress.sort()).toEqual(['ends-today', 'live', 'starts-today']);
    expect(r.completed.sort()).toEqual(['ends-yesterday', 'past']);
  });

  it('includes in-progress when opted in, still excludes completed', () => {
    const r = selectPrivacyApplyTargets(calendar, { includeInProgress: true, today });
    expect(r.selected.sort()).toEqual(['ends-today', 'future', 'live', 'starts-today']);
    // completed are never selected
    expect(r.selected).not.toContain('past');
    expect(r.selected).not.toContain('ends-yesterday');
  });

  it('drops entries with missing dates as skipped', () => {
    const r = selectPrivacyApplyTargets(
      [cal('ok', '2026-08-01', '2026-08-05'), { tournamentId: 'no-dates' }, { tournament: {} }],
      { includeInProgress: true, today },
    );
    expect(r.selected).toEqual(['ok']);
    expect(r.skipped).toEqual(['no-dates']);
  });

  it('handles an empty / undefined calendar', () => {
    expect(selectPrivacyApplyTargets([], { includeInProgress: true, today }).selected).toEqual([]);
    expect(selectPrivacyApplyTargets(undefined as any, { includeInProgress: true, today }).selected).toEqual([]);
  });
});
