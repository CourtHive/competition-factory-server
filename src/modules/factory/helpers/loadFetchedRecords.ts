import { factoryConstants } from 'tods-competition-factory';
import asyncGlobalState from '../engines/asyncGlobalState';

/**
 * Hand the fetched records to this request's engine state without copying them.
 *
 * `engine.setState(records)` copies every record, and `setState(records, false)` would avoid that
 * only by turning copying off for the whole process: the factory keeps that flag in module scope,
 * not in the per-request instance state, so every concurrent request would lose its copies too.
 * Storage parses each fetch from its own row, so nothing else holds these objects and the copy
 * protects nothing. Nor does a rollback snapshot: the engine runs with rollback off, because a
 * refused queue is never saved (executionQueue).
 *
 * Mirrors the checks `setState` makes on a keyed object, which the provider call does not.
 */
export function loadFetchedRecords(tournamentRecords: Record<string, any> | undefined) {
  const valid =
    !!tournamentRecords &&
    typeof tournamentRecords === 'object' &&
    Object.keys(tournamentRecords).every((id) => tournamentRecords[id]?.tournamentId === id);
  if (!valid) return { error: factoryConstants.errorConditionConstants.INVALID_RECORDS };

  asyncGlobalState.setTournamentId(undefined);
  asyncGlobalState.setTournamentRecords(tournamentRecords);
  return { success: true };
}
