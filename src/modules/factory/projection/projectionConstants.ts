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
 * The discovery projection — the read model's only AGGREGATE table.
 *
 * Cascade-covered, so it is registered in SNAPSHOT_CASCADE_COVERED_TABLES and must stay OUT of
 * SNAPSHOT_OWNED_TABLES: `query_tournament_discovery.tournament_id` references
 * `query_tournaments(tournament_id) ON DELETE CASCADE`, and TABLE_TOURNAMENTS is itself in the
 * owned purge scope — so a snapshot's purge of the parent removes this row already. Listing it in
 * both would be the bug the cascade list exists to prevent.
 */
export const TABLE_TOURNAMENT_DISCOVERY = 'tournament_discovery';

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
  TABLE_ENTRIES,
  TABLE_COURTS,
  TABLE_TOURNAMENT_VENUES,
] as const;

/**
 * Purged by FK cascade from a parent that IS in the scope above, so they must
 * not be listed there.
 *
 * `match_up_competitors` is here rather than in the owned list for a concrete
 * reason found by CI, not by reasoning: its projected rows do NOT reliably carry
 * `tournament_id` on the PUBLISHED factory (6.25.0, which is what production
 * runs), so `DELETE … WHERE tournament_id` would silently miss them and leave
 * orphans — exactly the failure the snapshot exists to prevent. It is reached
 * instead by `ON DELETE CASCADE` from `match_ups.match_up_id`.
 *
 * A local run cannot catch this: node_modules/tods-competition-factory is a
 * `link:` symlink to the sibling working copy (6.26.0, where the column IS
 * present), while CI installs the pinned published version.
 *
 * CONSUMER REQUIREMENT: courthive-query must actually declare these cascades.
 * They are mirrored in projection-conformance.spec.ts's FK_CASCADES, whose own
 * comment states that map must track the migrations exactly.
 */
export const SNAPSHOT_CASCADE_COVERED_TABLES = [TABLE_MATCH_UP_COMPETITORS, TABLE_TOURNAMENT_DISCOVERY] as const;

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
