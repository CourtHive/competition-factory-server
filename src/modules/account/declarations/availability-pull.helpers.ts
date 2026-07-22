/**
 * Pure helpers for the TD availability pull. Kept free of Nest / IO so the
 * translation + method-building logic is unit-testable in isolation; the
 * service is a thin wire between storage, the declarations client, and the
 * executionQueue.
 */
import { translateAvailabilityToPersonRequests } from 'tods-competition-factory';

import { CANONICAL_PERSON } from 'src/common/constants/canonicalPerson';

// A tournament realistically spans days, not years. Cap enumeration so a
// malformed date range can never produce a runaway loop.
const MAX_TOURNAMENT_DAYS = 366;

export interface AvailabilitySnapshot {
  personId: string;
  providerId?: string;
  status?: string;
  payload: any;
  updatedAt?: string;
}

export interface AvailabilityPullSummary {
  personsWithRequests: number;
  requestsAdded: number;
  ifNeeded: Record<string, string[]>; // personId → IF_NEEDED dates (advisory)
}

/** Inclusive list of calendar days ('YYYY-MM-DD') from startDate to endDate. */
export function enumerateDates(startDate?: string, endDate?: string): string[] {
  if (!startDate || !endDate) return [];
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];

  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end && dates.length < MAX_TOURNAMENT_DAYS) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Canonical personIds of a tournament's participants — the join key the
 * declarations service is keyed by. Read from `person.personOtherIds[]` where
 * `organisationId === CANONICAL_PERSON` (the id stamped by the HiveID link).
 */
export function extractCanonicalPersonIds(tournamentRecord: any): string[] {
  const participants = tournamentRecord?.participants ?? [];
  const ids = new Set<string>();
  for (const participant of participants) {
    const otherIds = participant?.person?.personOtherIds ?? [];
    for (const otherId of otherIds) {
      if (otherId?.organisationId === CANONICAL_PERSON && otherId?.personId) {
        ids.add(otherId.personId);
      }
    }
  }
  return [...ids];
}

/**
 * Turn availability snapshots into `addPersonRequests` executionQueue methods,
 * windowed to the tournament's dates. UNAVAILABLE days become whole-day
 * DO_NOT_SCHEDULE requests (via the factory translator); IF_NEEDED days are
 * collected as advisory metadata only.
 */
export function buildAvailabilityMethods(args: {
  snapshots: AvailabilitySnapshot[];
  dates: string[];
}): { methods: any[]; summary: AvailabilityPullSummary } {
  const { snapshots, dates } = args;
  const methods: any[] = [];
  const ifNeeded: Record<string, string[]> = {};
  let personsWithRequests = 0;
  let requestsAdded = 0;

  for (const snapshot of snapshots) {
    const { requests, ifNeededDates } = translateAvailabilityToPersonRequests({
      availability: snapshot.payload,
      dates,
    });
    if (ifNeededDates.length) ifNeeded[snapshot.personId] = ifNeededDates;
    if (requests.length) {
      methods.push({ method: 'addPersonRequests', params: { personId: snapshot.personId, requests } });
      personsWithRequests += 1;
      requestsAdded += requests.length;
    }
  }

  return { methods, summary: { personsWithRequests, requestsAdded, ifNeeded } };
}
