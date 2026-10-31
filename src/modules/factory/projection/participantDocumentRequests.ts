import type { ProjectionIntent } from './projectionTypes';

/** Intents that change what a public participant document holds. Scores, draws and schedules are not among them. */
const PARTICIPANT_INTENTS = new Set<ProjectionIntent['kind']>(['participants', 'deleteParticipants', 'claimPerson']);

/** Methods that change the privacy policy attached to a record, which every document of that record is built under. */
const POLICY_METHODS = new Set(['attachPolicies', 'removePolicy']);

/**
 * The tournaments whose public participant documents a mutation made stale (W3). Only participant changes and policy
 * changes count, so a live-scoring stream requests nothing. A policy method names no participant intent, so it
 * requests every tournament the call carried.
 */
export function documentRequestTournamentIds({
  intents,
  methods,
  tournamentIds,
}: {
  intents: ProjectionIntent[];
  methods?: { method?: string }[];
  tournamentIds: string[];
}): string[] {
  const ids = new Set<string>();
  for (const intent of intents) {
    if (PARTICIPANT_INTENTS.has(intent.kind) && intent.tournamentId) ids.add(intent.tournamentId);
  }
  if (methods?.some((method) => POLICY_METHODS.has(method?.method ?? ''))) {
    for (const tournamentId of tournamentIds) ids.add(tournamentId);
  }
  return [...ids];
}
