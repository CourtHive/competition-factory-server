import { Tournament } from 'tods-competition-factory';

// Generalized adapter contract for federation-data scrapers.
//
// Each implementation knows how to recognize and fetch tournament data from
// one federation's public website. The dispatcher (`FederationDataService`)
// is provider-agnostic: it iterates registered adapters and delegates to the
// first one whose `canHandle()` returns true.
//
// See `Mentat/planning/RANKING_LISTS_PIPELINE.md` ("Federation-data adapters
// (CFS-side)") for the full rationale.

export interface FederationDataAdapter {
  /** Stable identifier matching the federation in TODS (e.g., 'CTS', 'USTA'). */
  readonly provider: string;

  /** UUID — used as `TournamentRecord.parentOrganisation.organisationId`. */
  readonly organizationId: string;

  /** Returns true if this adapter can handle the given URL or identifier. */
  canHandle(identifier: string): boolean;

  /** Fetch + parse one tournament's full record (participants included when public). */
  fetchTournament(identifier: string): Promise<Tournament | { error: string }>;

  /** Optional: list tournaments in a date range (for back-fill scheduling). */
  fetchTournamentCalendar?(range: { start: Date; end: Date }): Promise<TournamentSummary[]>;

  /** Optional: fetch registrations only (subset of fetchTournament). */
  fetchRegistrations?(identifier: string): Promise<unknown[]>;
}

export interface TournamentSummary {
  tournamentId: string;
  identifier: string; // URL or stable handle the adapter can re-consume
  tournamentName?: string;
  startDate?: string;
  endDate?: string;
  ageCategory?: string;
  gender?: string;
}

/** DI token for the array of registered adapters wired in `FederationDataModule`. */
export const FEDERATION_ADAPTERS = 'FEDERATION_ADAPTERS';
