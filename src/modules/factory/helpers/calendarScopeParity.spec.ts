import { beforeEach, describe, expect, it } from 'vitest';

import { buildCalendarScope, scopeCalendarForUser } from './checkTournamentAccess';
import type { UserContext } from 'src/modules/account/auth/decorators/user-context.decorator';

/**
 * Migration 047 moved calendar scoping from a Node filter (`scopeCalendarForUser`) into SQL
 * driven by `buildCalendarScope`. Two implementations of one authorization rule is the P19
 * class, so this asserts they agree — by running the in-memory predicate and a faithful
 * re-implementation of the SQL predicate over the same entries and comparing results.
 *
 * The SQL itself is separately verified against a real Postgres; what is at risk here is the
 * TRANSLATION, which is the part a mocked pool can never catch.
 */

const P_ADMIN = 'p-admin';
const P_DIRECTOR = 'p-director';
const P_PROVISIONED = 'p-provisioned';
const P_FOREIGN = 'p-foreign';
const ME = 'user-me';

/** The synthesised actor a provisioner API-key save stamps — see `isProvisionerCreated`. */
const PROVISIONER_ACTOR = 'provisioner:prov-1';

const ENTRIES = [
  { tournamentId: 't-admin-own', providerId: P_ADMIN, createdByUserId: ME },
  { tournamentId: 't-admin-other', providerId: P_ADMIN, createdByUserId: 'someone' },
  { tournamentId: 't-dir-own', providerId: P_DIRECTOR, createdByUserId: ME },
  { tournamentId: 't-dir-other', providerId: P_DIRECTOR, createdByUserId: 'someone' },
  { tournamentId: 't-dir-assigned', providerId: P_DIRECTOR, createdByUserId: 'someone' },
  { tournamentId: 't-dir-provisioner-made', providerId: P_DIRECTOR, createdByUserId: PROVISIONER_ACTOR },
  { tournamentId: 't-dir-legacy', providerId: P_DIRECTOR, createdByUserId: undefined },
  { tournamentId: 't-prov', providerId: P_PROVISIONED, createdByUserId: 'someone' },
  { tournamentId: 't-foreign', providerId: P_FOREIGN, createdByUserId: PROVISIONER_ACTOR },
];

const ASSIGNED = new Set(['t-dir-assigned']);

/** The SQL predicate from `PostgresCalendarStorage.buildWhere`, evaluated in JS. */
function applySqlScope(entries: any[], scope: ReturnType<typeof buildCalendarScope>): any[] {
  if (scope.unrestricted) return entries;
  return entries.filter((entry) => {
    if (scope.fullAccessProviderIds.includes(entry.providerId)) return true;
    if (scope.directorProviderIds.includes(entry.providerId)) {
      if (scope.userId && entry.createdByUserId === scope.userId) return true;
      if (scope.assignedTournamentIds.includes(entry.tournamentId)) return true;
      // `created_by_user_id LIKE 'provisioner:%'` — the unconditional rung in buildWhere.
      return typeof entry.createdByUserId === 'string' && entry.createdByUserId.startsWith('provisioner:');
    }
    return false;
  });
}

function ids(entries: any[]): string[] {
  return entries.map((entry) => entry.tournamentId).sort();
}

function context(overrides: Partial<UserContext> = {}): UserContext {
  return {
    userId: ME,
    email: 'me@example.test',
    isSuperAdmin: false,
    globalRoles: ['CLIENT'],
    providerRoles: {},
    providerIds: [],
    ...overrides,
  } as UserContext;
}

describe('calendar scope parity — Node filter vs SQL translation', () => {
  beforeEach(() => {
    process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING = 'true';
  });

  const CASES: Array<[string, UserContext | undefined]> = [
    ['super-admin', context({ isSuperAdmin: true })],
    ['no user context', undefined],
    ['provider-admin at one provider', context({ providerRoles: { [P_ADMIN]: 'PROVIDER_ADMIN' } })],
    ['director at one provider', context({ providerRoles: { [P_DIRECTOR]: 'DIRECTOR' } })],
    [
      'admin at one, director at another',
      context({ providerRoles: { [P_ADMIN]: 'PROVIDER_ADMIN', [P_DIRECTOR]: 'DIRECTOR' } }),
    ],
    ['provisioner-inherited access', context({ provisionerProviderIds: [P_PROVISIONED] })],
    [
      'provisioner AND director',
      context({ providerRoles: { [P_DIRECTOR]: 'DIRECTOR' }, provisionerProviderIds: [P_PROVISIONED] }),
    ],
    ['no role anywhere', context()],
    ['director with no assignments', context({ providerRoles: { [P_DIRECTOR]: 'DIRECTOR' } })],
  ];

  it.each(CASES)('agrees for: %s', (_label, userContext) => {
    const viaFilter = scopeCalendarForUser(ENTRIES, userContext, ASSIGNED);
    const viaSql = applySqlScope(ENTRIES, buildCalendarScope(userContext, ASSIGNED));
    expect(ids(viaSql)).toEqual(ids(viaFilter));
  });

  it('agrees when scoping is disabled entirely', () => {
    process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING = 'false';
    const userContext = context({ providerRoles: { [P_DIRECTOR]: 'DIRECTOR' } });
    expect(ids(applySqlScope(ENTRIES, buildCalendarScope(userContext, ASSIGNED)))).toEqual(
      ids(scopeCalendarForUser(ENTRIES, userContext, ASSIGNED)),
    );
  });

  describe('the translation itself', () => {
    it('promotes a PROVIDER_ADMIN role to full access', () => {
      const scope = buildCalendarScope(context({ providerRoles: { [P_ADMIN]: 'PROVIDER_ADMIN' } }));
      expect(scope.fullAccessProviderIds).toEqual([P_ADMIN]);
      expect(scope.directorProviderIds).toEqual([]);
    });

    it('keeps a provisioned provider out of the director rung even when a role also exists', () => {
      const scope = buildCalendarScope(
        context({ providerRoles: { [P_PROVISIONED]: 'DIRECTOR' }, provisionerProviderIds: [P_PROVISIONED] }),
      );
      expect(scope.fullAccessProviderIds).toEqual([P_PROVISIONED]);
      expect(scope.directorProviderIds).toEqual([]);
    });

    it('marks super-admin unrestricted rather than enumerating providers', () => {
      const scope = buildCalendarScope(context({ isSuperAdmin: true }));
      expect(scope.unrestricted).toBe(true);
      expect(scope.fullAccessProviderIds).toEqual([]);
    });

    it('shows a director a provisioner-created tournament at their provider, but not at a foreign one', () => {
      const userContext = context({ providerRoles: { [P_DIRECTOR]: 'DIRECTOR' } });
      const visible = ids(scopeCalendarForUser(ENTRIES, userContext, ASSIGNED));

      expect(visible).toContain('t-dir-provisioner-made');
      // The provider rung still gates it: same creator, provider where the user holds nothing.
      expect(visible).not.toContain('t-foreign');
      // And it does not resurrect legacy entries that carry no creator at all.
      expect(visible).not.toContain('t-dir-legacy');
    });

    it('is restricted-with-no-providers for a caller with no identity', () => {
      const scope = buildCalendarScope(undefined);
      expect(scope.unrestricted).toBe(false);
      expect(scope.fullAccessProviderIds).toEqual([]);
      expect(scope.directorProviderIds).toEqual([]);
    });
  });
});
