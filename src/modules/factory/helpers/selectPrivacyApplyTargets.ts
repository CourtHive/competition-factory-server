/**
 * Classify a provider's calendar tournaments for the "apply participant-privacy
 * policy to existing tournaments" action, per the confirmed decisions:
 *   - UPCOMING tournaments are always selected,
 *   - IN-PROGRESS tournaments are selected only when the caller opts in,
 *   - COMPLETED / historical tournaments are NEVER touched.
 *
 * Classification is by calendar date only (date-only ISO strings compare
 * chronologically as plain strings):
 *   - completed:   endDate  <  today
 *   - in-progress: startDate <= today <= endDate
 *   - upcoming:    startDate >  today
 *
 * Entries with unusable dates are dropped (counted as `skipped`).
 */
export type CalendarTournament = {
  tournamentId?: string;
  tournament?: { startDate?: string; endDate?: string };
};

export type PrivacyApplyTargets = {
  selected: string[];
  upcoming: string[];
  inProgress: string[];
  completed: string[];
  skipped: string[];
};

export function selectPrivacyApplyTargets(
  tournaments: CalendarTournament[],
  { includeInProgress, today }: { includeInProgress: boolean; today: string },
): PrivacyApplyTargets {
  const result: PrivacyApplyTargets = { selected: [], upcoming: [], inProgress: [], completed: [], skipped: [] };

  for (const entry of tournaments ?? []) {
    const tournamentId = entry?.tournamentId;
    const startDate = entry?.tournament?.startDate;
    const endDate = entry?.tournament?.endDate;
    if (!tournamentId || !startDate || !endDate) {
      if (tournamentId) result.skipped.push(tournamentId);
      continue;
    }

    if (endDate < today) {
      result.completed.push(tournamentId);
    } else if (startDate > today) {
      result.upcoming.push(tournamentId);
      result.selected.push(tournamentId);
    } else {
      // startDate <= today <= endDate → in progress
      result.inProgress.push(tournamentId);
      if (includeInProgress) result.selected.push(tournamentId);
    }
  }

  return result;
}
