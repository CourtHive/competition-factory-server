// Read-model target tables (snake_case, matching the courthive-query schema
// in 001-read-model-tables.sql). row_data keys mirror those column names.
export const TABLE_TOURNAMENTS = 'tournaments';
export const TABLE_EVENTS = 'events';
export const TABLE_DRAWS = 'draws';
export const TABLE_STRUCTURES = 'structures';
export const TABLE_SEEDS = 'seeds';
export const TABLE_ORDER_OF_PLAY = 'order_of_play';
export const TABLE_SCHEDULING_PROFILE = 'scheduling_profile';
export const TABLE_PARTICIPANT_PUBLISH = 'participant_publish';
export const TABLE_MATCH_UPS = 'match_ups';
export const TABLE_MATCH_UP_COMPETITORS = 'match_up_competitors';
export const TABLE_ENTRIES = 'entries';
export const TABLE_VENUES = 'venues';
export const TABLE_COURTS = 'courts';
export const TABLE_TOURNAMENT_VENUES = 'tournament_venues';

/**
 * Tables a tournament SNAPSHOT owns and may purge by `tournament_id` before
 * re-applying the snapshot's upserts.
 *
 * WHY A FIXED LIST rather than deriving it from the emitted deltas: the case a
 * snapshot exists to handle is an entity that was REMOVED from the record. A
 * removed draw emits no delta, so a content-derived list would omit exactly the
 * table that needs sweeping — which is the whole bug.
 *
 * `venues` is deliberately EXCLUDED. It is a cross-tournament dimension keyed by
 * `venue_id` alone, shared between tournaments and linked per tournament through
 * `tournament_venues`. Purging it by tournament would delete venues belonging to
 * other tournaments. Its rows carry no `tournament_id` at all — verified against
 * real deltas by the snapshot guard spec, which asserts every table in THIS list
 * emits rows carrying `tournament_id`, and that `venues` does not.
 *
 * `courts` IS included: court rows are tournament-scoped (the incremental path
 * already deletes them by `{ tournament_id, venue_id }`).
 */
export const SNAPSHOT_OWNED_TABLES = [
  TABLE_TOURNAMENTS,
  TABLE_EVENTS,
  TABLE_DRAWS,
  TABLE_STRUCTURES,
  TABLE_SEEDS,
  TABLE_ORDER_OF_PLAY,
  TABLE_SCHEDULING_PROFILE,
  TABLE_PARTICIPANT_PUBLISH,
  TABLE_MATCH_UPS,
  TABLE_MATCH_UP_COMPETITORS,
  TABLE_ENTRIES,
  TABLE_COURTS,
  TABLE_TOURNAMENT_VENUES,
] as const;

/** Projected tables a snapshot must never purge — cross-tournament dimensions. */
export const SNAPSHOT_SHARED_TABLES = [TABLE_VENUES] as const;

// match_up_competitors.link_source
export const LINK_PROVIDER_ID = 'providerId';
export const LINK_UNRESOLVED = 'unresolved';
export const LINK_CANONICAL = 'canonical';

// match_ups.match_up_level
export const LEVEL_STANDARD = 'STANDARD';
export const LEVEL_TIE = 'TIE';
export const LEVEL_RUBBER = 'RUBBER';
