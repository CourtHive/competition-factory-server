export const CALENDAR_STORAGE = Symbol('CALENDAR_STORAGE');

/**
 * Visibility scoping for a calendar read, resolved from the caller's UserContext by
 * `buildCalendarScope` and applied in SQL rather than by filtering rows in Node.
 *
 * The three cases mirror `scopeCalendarForUser` exactly — see its tests, which remain the
 * behaviour contract across migration 047:
 *
 *  - `unrestricted` — scoping disabled, or the caller is a super-admin;
 *  - `fullAccessProviderIds` — provisioner-inherited, or PROVIDER_ADMIN at that provider:
 *    every tournament of those providers;
 *  - `directorProviderIds` — any other role at that provider: only tournaments the caller
 *    created, or that are explicitly assigned to them.
 */
export interface CalendarScope {
  unrestricted: boolean;
  fullAccessProviderIds: string[];
  directorProviderIds: string[];
  userId?: string;
  assignedTournamentIds: string[];
}

export interface CalendarQuery {
  /** Providers to read. Empty means "no target" and MUST return nothing, never everything. */
  providerIds: string[];
  scope: CalendarScope;
  /** Public surface: published only. */
  publishedOnly?: boolean;
  limit: number;
  offset: number;
}

export interface ICalendarStorage {
  /** One tournament's calendar row. Upsert on `tournament_id`, which is also how a
   *  provider MOVE is expressed — no detach sweep. */
  upsertTournament(row: any): Promise<{ success: boolean }>;
  removeTournament(tournamentId: string): Promise<{ success: boolean }>;
  getTournament(tournamentId: string): Promise<any | null>;

  /**
   * Scoped, paged read. Returns the page, the grand pre-window total, and the pre-window
   * total PER PROVIDER — the last because the response carries a per-calendar `total`, so a
   * client can say "showing 20 of 1,200 for this provider" without a second request.
   */
  queryTournaments(
    query: CalendarQuery,
  ): Promise<{ rows: any[]; total: number; totalsByProvider: Record<string, number> }>;

  /** Every row for one provider, unscoped. Admin/batch callers only (rankings republish,
   *  privacy-policy apply) — never a user-facing list. */
  listProviderTournaments(providerId: string): Promise<any[]>;
}
