import type { CalendarQuery, CalendarScope, ICalendarStorage } from 'src/storage/interfaces/calendar-storage.interface';

/**
 * An in-memory `ICalendarStorage` for unit tests, mirroring `calendar_tournaments`.
 *
 * ## Why this exists rather than a bare `vi.fn()`
 *
 * The calendar's authorization and paging moved into SQL with migration 047. A mock that
 * just returns rows would let the SERVICE tests pass while the predicate they are supposed
 * to exercise says something else — architectural standard **A1**, mock divergence.
 *
 * So the filter below is a deliberate re-statement of
 * `PostgresCalendarStorage.buildWhere`, and it is pinned from two directions:
 *
 *  - `calendarScopeParity.spec.ts` asserts this same predicate agrees with
 *    `scopeCalendarForUser`, the in-memory rule it replaced;
 *  - the SQL itself was executed against a real Postgres across every scope shape
 *    (provider-admin, director own/assigned/other, provisioner, no-role, published-only,
 *    NULL start_date paging) before this was written.
 *
 * What this fake CANNOT prove is that the SQL string is valid or that its plan is sane.
 * That needs a real database, and is the standing gap in these tests.
 */
export function matchesCalendarScope(entry: any, scope: CalendarScope): boolean {
  if (scope.unrestricted) return true;
  if (scope.fullAccessProviderIds.includes(entry.providerId)) return true;
  if (scope.directorProviderIds.includes(entry.providerId)) {
    if (scope.userId && entry.createdByUserId === scope.userId) return true;
    return scope.assignedTournamentIds.includes(entry.tournamentId);
  }
  return false;
}

export class InMemoryCalendarStorage implements ICalendarStorage {
  /** Entry shape, keyed by tournamentId — the same shape `fromRow` returns. */
  public entries = new Map<string, any>();

  constructor(seed: any[] = []) {
    for (const entry of seed) this.entries.set(entry.tournamentId, entry);
  }

  async upsertTournament(row: any) {
    // Rows arrive column-shaped; store enough to read back as an entry.
    this.entries.set(row.tournament_id, {
      tournamentId: row.tournament_id,
      providerId: row.provider_id,
      searchText: row.search_text,
      published: row.published === true,
      createdByUserId: row.created_by_user_id ?? undefined,
      tournament: { tournamentId: row.tournament_id, tournamentName: row.tournament_name, startDate: row.start_date },
    });
    return { success: true };
  }

  async removeTournament(tournamentId: string) {
    this.entries.delete(tournamentId);
    return { success: true };
  }

  async getTournament(tournamentId: string) {
    return this.entries.get(tournamentId) ?? null;
  }

  async queryTournaments(query: CalendarQuery) {
    if (!query.providerIds.length) return { rows: [], total: 0, totalsByProvider: {} };

    const matched = [...this.entries.values()]
      .filter((entry) => query.providerIds.includes(entry.providerId))
      .filter((entry) => matchesCalendarScope(entry, query.scope))
      .filter((entry) => !query.publishedOnly || entry.published === true)
      // Mirrors `ORDER BY start_date DESC NULLS LAST, tournament_id`.
      .sort((a, b) => {
        const aDate = a.tournament?.startDate ?? '';
        const bDate = b.tournament?.startDate ?? '';
        if (aDate !== bDate) {
          if (!aDate) return 1;
          if (!bDate) return -1;
          return bDate.localeCompare(aDate);
        }
        return a.tournamentId.localeCompare(b.tournamentId);
      });

    const totalsByProvider: Record<string, number> = {};
    for (const entry of matched) totalsByProvider[entry.providerId] = (totalsByProvider[entry.providerId] ?? 0) + 1;

    return {
      rows: matched.slice(query.offset, query.offset + query.limit),
      total: matched.length,
      totalsByProvider,
    };
  }

  async listProviderTournaments(providerId: string) {
    return [...this.entries.values()].filter((entry) => entry.providerId === providerId);
  }
}
