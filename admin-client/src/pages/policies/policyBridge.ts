/**
 * Builtin policy catalog — sourced from `tods-competition-factory` fixtures.
 * The Policies page seeds the courthive-components catalog with these
 * read-only items; per-provider user policies come from the server's
 * generic catalog endpoint (`/provider/:id/catalog/policy`).
 *
 * Builtin IDs are stable strings (`builtin-<slug>`) so the same builtin
 * always shows up under the same id between sessions. User IDs are server
 * UUIDs.
 */
import { fixtures, policyConstants } from 'tods-competition-factory';
import type { PolicyCatalogItem } from 'courthive-components';

const {
  POLICY_TYPE_SCHEDULING,
  POLICY_TYPE_SCORING,
  POLICY_TYPE_SEEDING,
  POLICY_TYPE_RANKING_POINTS,
} = policyConstants;

const {
  policies: {
    POLICY_RANKING_POINTS_ATP,
    POLICY_RANKING_POINTS_BASIC,
    POLICY_RANKING_POINTS_WTA,
    POLICY_RANKING_POINTS_ITF_WTT,
    POLICY_RANKING_POINTS_ITF_JUNIOR,
    POLICY_RANKING_POINTS_TENNIS_EUROPE,
    POLICY_RANKING_POINTS_USTA_JUNIOR,
    POLICY_RANKING_POINTS_LTA,
    POLICY_RANKING_POINTS_TENNIS_AUSTRALIA,
    POLICY_RANKING_POINTS_TENNIS_CANADA,
    POLICY_SCHEDULING_DEFAULT,
    POLICY_SCORING_DEFAULT,
    POLICY_SCORING_USTA,
    POLICY_SEEDING_DEFAULT,
    POLICY_SEEDING_ITF,
  },
} = fixtures as any;

export const BUILTIN_POLICIES: PolicyCatalogItem[] = [
  {
    id: 'builtin-scheduling-default',
    name: 'Default Scheduling',
    policyType: POLICY_TYPE_SCHEDULING,
    source: 'builtin',
    description: 'Default match scheduling times, recovery periods, and daily limits',
    policyData: POLICY_SCHEDULING_DEFAULT[POLICY_TYPE_SCHEDULING],
  },
  {
    id: 'builtin-scoring-default',
    name: 'Default Scoring',
    policyType: POLICY_TYPE_SCORING,
    source: 'builtin',
    description: 'Default scoring formats and match completion rules',
    policyData: POLICY_SCORING_DEFAULT[POLICY_TYPE_SCORING],
  },
  {
    id: 'builtin-scoring-usta',
    name: 'USTA Scoring',
    policyType: POLICY_TYPE_SCORING,
    source: 'builtin',
    description: 'USTA-flavored scoring rules',
    policyData: POLICY_SCORING_USTA[POLICY_TYPE_SCORING],
  },
  {
    id: 'builtin-seeding-default',
    name: 'Default Seeding',
    policyType: POLICY_TYPE_SEEDING,
    source: 'builtin',
    description: 'Default seeding thresholds and positioning rules',
    policyData: POLICY_SEEDING_DEFAULT[POLICY_TYPE_SEEDING],
  },
  {
    id: 'builtin-seeding-itf',
    name: 'ITF Seeding',
    policyType: POLICY_TYPE_SEEDING,
    source: 'builtin',
    description: 'ITF seeding pattern',
    policyData: POLICY_SEEDING_ITF[POLICY_TYPE_SEEDING],
  },
  {
    id: 'builtin-ranking-points-basic',
    name: 'Basic Ranking Points',
    policyType: POLICY_TYPE_RANKING_POINTS,
    source: 'builtin',
    description: 'Simple finishing-position points — works for any event regardless of category or level',
    policyData: POLICY_RANKING_POINTS_BASIC[POLICY_TYPE_RANKING_POINTS],
  },
  {
    id: 'builtin-ranking-points-atp',
    name: 'ATP Ranking Points (2026)',
    policyType: POLICY_TYPE_RANKING_POINTS,
    source: 'builtin',
    description: 'PIF ATP Rankings — Grand Slams through ITF events, 15 tournament levels',
    policyData: POLICY_RANKING_POINTS_ATP[POLICY_TYPE_RANKING_POINTS],
  },
  {
    id: 'builtin-ranking-points-wta',
    name: 'WTA Ranking Points (2026)',
    policyType: POLICY_TYPE_RANKING_POINTS,
    source: 'builtin',
    description: 'PIF WTA Rankings — Grand Slams through WTA 125, with quality win bonuses',
    policyData: POLICY_RANKING_POINTS_WTA[POLICY_TYPE_RANKING_POINTS],
  },
  {
    id: 'builtin-ranking-points-itf-wtt',
    name: 'ITF World Tennis Tour Points',
    policyType: POLICY_TYPE_RANKING_POINTS,
    source: 'builtin',
    description: 'ITF World Tennis Tour — qualifying round points for $15K–$25K+H tournaments',
    policyData: POLICY_RANKING_POINTS_ITF_WTT[POLICY_TYPE_RANKING_POINTS],
  },
  {
    id: 'builtin-ranking-points-itf-junior',
    name: 'ITF Junior Points',
    policyType: POLICY_TYPE_RANKING_POINTS,
    source: 'builtin',
    description: 'ITF Junior World Tour points',
    policyData: POLICY_RANKING_POINTS_ITF_JUNIOR[POLICY_TYPE_RANKING_POINTS],
  },
  {
    id: 'builtin-ranking-points-tennis-europe',
    name: 'Tennis Europe Points',
    policyType: POLICY_TYPE_RANKING_POINTS,
    source: 'builtin',
    description: 'Tennis Europe Junior Tour points',
    policyData: POLICY_RANKING_POINTS_TENNIS_EUROPE[POLICY_TYPE_RANKING_POINTS],
  },
  {
    id: 'builtin-ranking-points-usta-junior',
    name: 'USTA Junior Points',
    policyType: POLICY_TYPE_RANKING_POINTS,
    source: 'builtin',
    description: 'USTA Junior National & Section ranking points',
    policyData: POLICY_RANKING_POINTS_USTA_JUNIOR[POLICY_TYPE_RANKING_POINTS],
  },
  {
    id: 'builtin-ranking-points-lta',
    name: 'LTA Points',
    policyType: POLICY_TYPE_RANKING_POINTS,
    source: 'builtin',
    description: 'Lawn Tennis Association ranking points',
    policyData: POLICY_RANKING_POINTS_LTA[POLICY_TYPE_RANKING_POINTS],
  },
  {
    id: 'builtin-ranking-points-tennis-australia',
    name: 'Tennis Australia Points',
    policyType: POLICY_TYPE_RANKING_POINTS,
    source: 'builtin',
    description: 'Tennis Australia ranking points',
    policyData: POLICY_RANKING_POINTS_TENNIS_AUSTRALIA[POLICY_TYPE_RANKING_POINTS],
  },
  {
    id: 'builtin-ranking-points-tennis-canada',
    name: 'Tennis Canada Points',
    policyType: POLICY_TYPE_RANKING_POINTS,
    source: 'builtin',
    description: 'Tennis Canada ranking points',
    policyData: POLICY_RANKING_POINTS_TENNIS_CANADA[POLICY_TYPE_RANKING_POINTS],
  },
];
