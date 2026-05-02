/**
 * Canonical option lists for the Settings panel's constant-backed
 * selects. Mirrors values in the factory's constants modules — kept
 * inline here so the admin-client bundle doesn't pull the whole
 * factory just for a handful of strings.
 */

export const EVENT_TYPE_OPTIONS = ['SINGLES', 'DOUBLES', 'TEAM'] as const;

export const GENDER_OPTIONS = ['MALE', 'FEMALE', 'MIXED', 'ANY'] as const;

export const DRAW_TYPE_OPTIONS = [
  'SINGLE_ELIMINATION',
  'ROUND_ROBIN',
  'ROUND_ROBIN_WITH_PLAYOFF',
  'COMPASS',
  'FEED_IN_CHAMPIONSHIP',
  'FIRST_MATCH_LOSER_CONSOLATION',
  'FIRST_ROUND_LOSER_CONSOLATION',
  'CURTIS_CONSOLATION',
  'AD_HOC',
] as const;

export const CREATION_METHOD_OPTIONS = ['AUTOMATED', 'MANUAL', 'DRAFT'] as const;

export const SCORING_APPROACH_OPTIONS = [
  'dynamicSets',
  'freeScore',
  'dialPad',
  'inlineScoring',
] as const;
