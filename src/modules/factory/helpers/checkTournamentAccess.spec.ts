// Mock the lazy feature flag function to always return true for tests
jest.mock('src/common/constants/feature-flags', () => ({
  isTournamentAccessScopingEnabled: () => true,
}));

import { canViewTournament, canMutateTournament, scopeCalendarForUser, CREATED_BY_USER_ID } from './checkTournamentAccess';
import type { UserContext } from 'src/modules/account/auth/decorators/user-context.decorator';

// ── Fixtures ──

function makeTournament(providerId: string, createdByUserId?: string): any {
  const tournament: any = {
    tournamentId: `t-${providerId}-${Math.random().toString(36).slice(2, 6)}`,
    parentOrganisation: { organisationId: providerId },
  };
  if (createdByUserId) {
    tournament.extensions = [{ name: CREATED_BY_USER_ID, value: createdByUserId }];
  }
  return tournament;
}

function makeCtx(overrides: Partial<UserContext> = {}): UserContext {
  return {
    userId: 'user-uuid-1',
    email: 'test@example.com',
    isSuperAdmin: false,
    globalRoles: ['client'],
    providerRoles: {},
    providerIds: [],
    ...overrides,
  };
}

const superAdmin = makeCtx({ isSuperAdmin: true, globalRoles: ['superadmin', 'client'] });
const providerAdmin = makeCtx({
  providerRoles: { 'prov-1': 'PROVIDER_ADMIN' },
  providerIds: ['prov-1'],
});
const director = makeCtx({
  providerRoles: { 'prov-1': 'DIRECTOR' },
  providerIds: ['prov-1'],
});
const multiProvider = makeCtx({
  providerRoles: { 'prov-1': 'PROVIDER_ADMIN', 'prov-2': 'DIRECTOR' },
  providerIds: ['prov-1', 'prov-2'],
});

// Flag-OFF bypass is tested by verifying the helper code path returns true
// immediately when the constant is false. jest.mock above forces it ON so
// every rule path is exercised. The flag-OFF behavior is trivially correct
// (single early-return line) and does not need its own suite.

describe('checkTournamentAccess (flag ON via jest.mock)', () => {

  describe('canViewTournament', () => {
    it('SUPER_ADMIN sees everything', () => {
      let result: any = canViewTournament(makeTournament('prov-1'), superAdmin);
      expect(result).toBe(true);
      result = canViewTournament(makeTournament('prov-99'), superAdmin);
      expect(result).toBe(true);
    });

    it('PROVIDER_ADMIN sees all tournaments in their provider', () => {
      let result: any = canViewTournament(makeTournament('prov-1'), providerAdmin);
      expect(result).toBe(true);
    });

    it('PROVIDER_ADMIN does NOT see tournaments in other providers', () => {
      let result: any = canViewTournament(makeTournament('prov-2'), providerAdmin);
      expect(result).toBe(false);
    });

    it('DIRECTOR sees tournaments they created', () => {
      const tournament = makeTournament('prov-1', 'user-uuid-1');
      let result: any = canViewTournament(tournament, director);
      expect(result).toBe(true);
    });

    it('DIRECTOR sees tournaments they are assigned to', () => {
      const tournament = makeTournament('prov-1', 'other-user');
      const assigned = new Set([tournament.tournamentId]);
      let result: any = canViewTournament(tournament, director, assigned);
      expect(result).toBe(true);
    });

    it('DIRECTOR does NOT see tournaments they neither created nor are assigned to', () => {
      const tournament = makeTournament('prov-1', 'other-user');
      let result: any = canViewTournament(tournament, director);
      expect(result).toBe(false);
    });

    it('DIRECTOR does NOT see legacy tournaments (no createdByUserId)', () => {
      const tournament = makeTournament('prov-1'); // no createdByUserId
      let result: any = canViewTournament(tournament, director);
      expect(result).toBe(false);
    });

    it('user with no association to the provider has no access', () => {
      const tournament = makeTournament('prov-99', 'user-uuid-1');
      let result: any = canViewTournament(tournament, director);
      expect(result).toBe(false);
    });

    it('unauthenticated (undefined userContext) gets no access', () => {
      let result: any = canViewTournament(makeTournament('prov-1'), undefined);
      expect(result).toBe(false);
    });

    it('tournaments with no provider (demo/sandbox) are always visible', () => {
      const tournament = { tournamentId: 'demo-1' }; // no parentOrganisation
      let result: any = canViewTournament(tournament, director);
      expect(result).toBe(true);
    });

    it('multi-provider user: PROVIDER_ADMIN at prov-1, DIRECTOR at prov-2', () => {
      // prov-1: sees everything
      let result: any = canViewTournament(makeTournament('prov-1', 'other'), multiProvider);
      expect(result).toBe(true);

      // prov-2: only own / assigned
      const ownTournament = makeTournament('prov-2', 'user-uuid-1');
      result = canViewTournament(ownTournament, multiProvider);
      expect(result).toBe(true);

      const otherTournament = makeTournament('prov-2', 'other');
      result = canViewTournament(otherTournament, multiProvider);
      expect(result).toBe(false);

      // prov-3: no association
      result = canViewTournament(makeTournament('prov-3'), multiProvider);
      expect(result).toBe(false);
    });
  });

  describe('canMutateTournament', () => {
    it('viewing remains a precondition', () => {
      let result: any = canMutateTournament(makeTournament('prov-1'), providerAdmin);
      expect(result).toBe(true);

      result = canMutateTournament(makeTournament('prov-2'), providerAdmin);
      expect(result).toBe(false);

      result = canMutateTournament(makeTournament('prov-1', 'user-uuid-1'), director);
      expect(result).toBe(true);

      result = canMutateTournament(makeTournament('prov-1', 'other'), director);
      expect(result).toBe(false);
    });

    // The assignment_role classification. Before this landed, `canMutateTournament`
    // simply returned `canViewTournament`, so EVERY assertion below that expects
    // `false` would have returned `true` — granting SCORER conferred DIRECTOR.
    describe('assignment_role governs assignment-derived access', () => {
      // Owned by someone else, so `director` reaches it only via the assignment row.
      const assigned = makeTournament('prov-1', 'someone-else');
      const roles = (role: string) => new Map([[assigned.tournamentId, role]]);

      it('DIRECTOR assignment mutates anything', () => {
        expect(canMutateTournament(assigned, director, roles('DIRECTOR'), ['addEvent'])).toBe(true);
      });

      it('ASSISTANT is not narrowed (deferred to the preset work)', () => {
        expect(canMutateTournament(assigned, director, roles('ASSISTANT'), ['addEvent'])).toBe(true);
      });

      it('OBSERVER cannot mutate, even a scoring method', () => {
        expect(canMutateTournament(assigned, director, roles('OBSERVER'), ['setMatchUpStatus'])).toBe(false);
        expect(canMutateTournament(assigned, director, roles('OBSERVER'), ['addEvent'])).toBe(false);
      });

      it('SCORER may score', () => {
        expect(canMutateTournament(assigned, director, roles('SCORER'), ['setMatchUpStatus'])).toBe(true);
      });

      it('SCORER may NOT create draws, schedule, or delete', () => {
        for (const method of ['addDrawDefinition', 'bulkScheduleMatchUps', 'deleteEvents', 'addParticipants']) {
          expect(canMutateTournament(assigned, director, roles('SCORER'), [method])).toBe(false);
        }
      });

      it('SCORER is denied a mixed batch that smuggles a non-scoring method', () => {
        const batch = ['setMatchUpStatus', 'bulkScheduleMatchUps'];
        expect(canMutateTournament(assigned, director, roles('SCORER'), batch)).toBe(false);
      });

      it('SCORER is denied when no methods are supplied — "may you mutate at all" is no', () => {
        expect(canMutateTournament(assigned, director, roles('SCORER'), [])).toBe(false);
        expect(canMutateTournament(assigned, director, roles('SCORER'))).toBe(false);
      });

      it('an unrecognised role keeps its pre-existing full access rather than silently losing it', () => {
        expect(canMutateTournament(assigned, director, roles('CUSTOM_LEGACY_ROLE'), ['addEvent'])).toBe(true);
      });

      it('role matching is case-insensitive', () => {
        expect(canMutateTournament(assigned, director, roles('scorer'), ['addEvent'])).toBe(false);
        expect(canMutateTournament(assigned, director, roles('observer'), ['setMatchUpStatus'])).toBe(false);
      });

      it('a SCORER row does NOT downgrade access that is not assignment-derived', () => {
        // PROVIDER_ADMIN reaches every tournament at the provider without an
        // assignment; a stray SCORER row must not narrow them.
        expect(canMutateTournament(assigned, providerAdmin, roles('SCORER'), ['addEvent'])).toBe(true);

        // Nor the creator of the tournament.
        const owned = makeTournament('prov-1', 'user-uuid-1');
        const ownedScorer = new Map([[owned.tournamentId, 'SCORER']]);
        expect(canMutateTournament(owned, director, ownedScorer, ['addEvent'])).toBe(true);

        // Nor a super-admin.
        expect(canMutateTournament(assigned, superAdmin, roles('OBSERVER'), ['addEvent'])).toBe(true);
      });
    });
  });

  describe('scopeCalendarForUser', () => {
    const entries = [
      { tournamentId: 't1', providerId: 'prov-1', createdByUserId: 'user-uuid-1' },
      { tournamentId: 't2', providerId: 'prov-1', createdByUserId: 'other-user' },
      { tournamentId: 't3', providerId: 'prov-2', createdByUserId: 'user-uuid-1' },
      { tournamentId: 't4', providerId: 'prov-2', createdByUserId: 'other-user' },
      { tournamentId: 't5' }, // no provider (demo)
    ];

    it('SUPER_ADMIN sees all', () => {
      let result: any = scopeCalendarForUser(entries, superAdmin);
      expect(result).toEqual(entries);
    });

    it('PROVIDER_ADMIN at prov-1 sees only prov-1 entries + unscoped', () => {
      let result: any = scopeCalendarForUser(entries, providerAdmin);
      const ids = result.map((e) => e.tournamentId);
      expect(ids).toEqual(['t1', 't2', 't5']);
    });

    it('DIRECTOR at prov-1 sees own prov-1 entries + unscoped', () => {
      let result: any = scopeCalendarForUser(entries, director);
      const ids = result.map((e) => e.tournamentId);
      expect(ids).toEqual(['t1', 't5']);
    });

    it('DIRECTOR sees assigned entries', () => {
      const assigned = new Set(['t2']);
      let result: any = scopeCalendarForUser(entries, director, assigned);
      const ids = result.map((e) => e.tournamentId);
      expect(ids).toEqual(['t1', 't2', 't5']);
    });

    it('multi-provider user sees correct mix', () => {
      let result: any = scopeCalendarForUser(entries, multiProvider);
      const ids = result.map((e) => e.tournamentId);
      // prov-1: PROVIDER_ADMIN → t1, t2
      // prov-2: DIRECTOR, own → t3
      // unscoped → t5
      expect(ids).toEqual(['t1', 't2', 't3', 't5']);
    });

    it('unauthenticated returns empty', () => {
      let result: any = scopeCalendarForUser(entries, undefined);
      expect(result).toEqual([]);
    });
  });
});
