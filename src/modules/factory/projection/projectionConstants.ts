// Read-model target tables (snake_case, matching the courthive-query schema
// in 001-read-model-tables.sql). row_data keys mirror those column names.
export const TABLE_TOURNAMENTS = 'tournaments';
export const TABLE_EVENTS = 'events';
export const TABLE_MATCH_UPS = 'match_ups';
export const TABLE_MATCH_UP_COMPETITORS = 'match_up_competitors';
export const TABLE_ENTRIES = 'entries';
export const TABLE_VENUES = 'venues';
export const TABLE_TOURNAMENT_VENUES = 'tournament_venues';

// match_up_competitors.link_source
export const LINK_PROVIDER_ID = 'providerId';
export const LINK_UNRESOLVED = 'unresolved';
export const LINK_CANONICAL = 'canonical';

// match_ups.match_up_level
export const LEVEL_STANDARD = 'STANDARD';
export const LEVEL_TIE = 'TIE';
export const LEVEL_RUBBER = 'RUBBER';
