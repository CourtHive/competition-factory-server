import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CALENDAR_PAGE_SIZE, MAX_CALENDAR_PAGE_SIZE } from './helpers/calendarPaging';
import type { UserContext } from 'src/modules/account/auth/decorators/user-context.decorator';
import { ProvidersService } from './providers.service';

/**
 * Regression cover for the 2026-09-15 production incident: a super-admin who
 * stopped impersonating was served every provider's calendar — 49,000+
 * tournaments in one unbounded response.
 */

const PROVIDER_A = 'provider-a-id';
const PROVIDER_B = 'provider-b-id';

function tournament(tournamentId: string, providerId: string) {
  return { tournamentId, providerId, parentOrganisation: { organisationId: providerId } };
}

function buildService(calendars: Record<string, { provider: any; tournaments: any[] }>) {
  const getCalendar = vi.fn(async (abbr: string) => calendars[abbr] ?? null);
  const getProviders = vi.fn(async () => [
    { key: PROVIDER_A, value: { organisationId: PROVIDER_A, organisationAbbreviation: 'AAA' } },
    { key: PROVIDER_B, value: { organisationId: PROVIDER_B, organisationAbbreviation: 'BBB' } },
  ]);

  const service = new ProvidersService(
    { getProviders } as any,
    { getCalendar } as any,
    { findByUserId: vi.fn(async () => []) } as any,
    {} as any,
    {} as any,
  );

  return { service, getCalendar, getProviders };
}

function superAdmin(): UserContext {
  return {
    userId: 'super-admin-user',
    email: 'super@courthive.com',
    isSuperAdmin: true,
    globalRoles: ['SUPER_ADMIN'],
    providerRoles: {},
    providerIds: [],
  };
}

function providerAdmin(providerId: string): UserContext {
  return {
    userId: 'provider-admin-user',
    email: 'admin@example.com',
    isSuperAdmin: false,
    globalRoles: ['CLIENT'],
    providerRoles: { [providerId]: 'PROVIDER_ADMIN' },
    providerIds: [providerId],
  };
}

describe('getMyCalendars', () => {
  beforeEach(() => {
    // Deterministic per test (A6) — the helper defaults to enabled when unset,
    // but these assertions are about scoping, so say so out loud.
    process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING = 'true';
  });

  describe('super-admin with no providerAbbr', () => {
    it('returns NO calendars — never the whole corpus', async () => {
      const { service } = buildService({
        AAA: { provider: { organisationAbbreviation: 'AAA' }, tournaments: [tournament('t1', PROVIDER_A)] },
        BBB: { provider: { organisationAbbreviation: 'BBB' }, tournaments: [tournament('t2', PROVIDER_B)] },
      });

      const result: any = await service.getMyCalendars({}, superAdmin());

      expect(result.success).toBe(true);
      expect(result.calendars).toEqual([]);
      expect(result.paging).toMatchObject({ total: 0, returned: 0, hasMore: false });
    });

    it('does not read a single calendar — the fan-out is gone, not merely filtered', async () => {
      const { service, getCalendar, getProviders } = buildService({
        AAA: { provider: {}, tournaments: [tournament('t1', PROVIDER_A)] },
      });

      await service.getMyCalendars({}, superAdmin());

      expect(getCalendar).not.toHaveBeenCalled();
      expect(getProviders).not.toHaveBeenCalled();
    });

    it('still serves a provider the super-admin names explicitly', async () => {
      const { service } = buildService({
        AAA: { provider: { organisationAbbreviation: 'AAA' }, tournaments: [tournament('t1', PROVIDER_A)] },
      });

      const result: any = await service.getMyCalendars({ providerAbbr: 'AAA' }, superAdmin());

      expect(result.calendars).toHaveLength(1);
      expect(result.calendars[0].tournaments).toHaveLength(1);
    });
  });

  describe('membership scoping', () => {
    it('resolves a member’s providerIds to calendar abbreviations', async () => {
      const { service } = buildService({
        AAA: { provider: {}, tournaments: [tournament('t1', PROVIDER_A)] },
        BBB: { provider: {}, tournaments: [tournament('t2', PROVIDER_B)] },
      });

      const result: any = await service.getMyCalendars({}, providerAdmin(PROVIDER_A));

      expect(result.calendars).toHaveLength(1);
      expect(result.calendars[0].providerAbbr).toBe('AAA');
      expect(result.calendars[0].tournaments.map((t: any) => t.tournamentId)).toEqual(['t1']);
    });

    it('returns nothing for a user with no memberships', async () => {
      const { service } = buildService({ AAA: { provider: {}, tournaments: [tournament('t1', PROVIDER_A)] } });
      const nobody: UserContext = { ...providerAdmin(PROVIDER_A), providerRoles: {}, providerIds: [] };

      const result: any = await service.getMyCalendars({}, nobody);

      expect(result.calendars).toEqual([]);
    });
  });

  describe('paging', () => {
    const many = (count: number, providerId = PROVIDER_A) =>
      Array.from({ length: count }, (_, i) => tournament(`t${i}`, providerId));

    it('caps an unasked-for response at the default page size', async () => {
      const { service } = buildService({ AAA: { provider: {}, tournaments: many(1200) } });

      const result: any = await service.getMyCalendars({ providerAbbr: 'AAA' }, superAdmin());

      expect(result.calendars[0].tournaments).toHaveLength(DEFAULT_CALENDAR_PAGE_SIZE);
      expect(result.paging).toMatchObject({
        limit: DEFAULT_CALENDAR_PAGE_SIZE,
        offset: 0,
        total: 1200,
        returned: DEFAULT_CALENDAR_PAGE_SIZE,
        hasMore: true,
      });
    });

    it('reports the FULL total so a truncated page is never silent', async () => {
      const { service } = buildService({ AAA: { provider: {}, tournaments: many(49000) } });

      const result: any = await service.getMyCalendars({ providerAbbr: 'AAA', limit: 10 }, superAdmin());

      expect(result.paging.total).toBe(49000);
      expect(result.paging.hasMore).toBe(true);
      expect(result.calendars[0].total).toBe(49000);
    });

    it('clamps a caller asking for more than the ceiling', async () => {
      const { service } = buildService({ AAA: { provider: {}, tournaments: many(5000) } });

      const result: any = await service.getMyCalendars(
        { providerAbbr: 'AAA', limit: Number.MAX_SAFE_INTEGER },
        superAdmin(),
      );

      expect(result.paging.limit).toBe(MAX_CALENDAR_PAGE_SIZE);
      expect(result.calendars[0].tournaments).toHaveLength(MAX_CALENDAR_PAGE_SIZE);
    });

    it.each([
      ['zero', 0],
      ['negative', -1],
      ['not a number', 'all' as any],
    ])('treats a %s limit as the default, not as unbounded', async (_label, limit) => {
      const { service } = buildService({ AAA: { provider: {}, tournaments: many(1200) } });

      const result: any = await service.getMyCalendars({ providerAbbr: 'AAA', limit }, superAdmin());

      expect(result.calendars[0].tournaments.length).toBeLessThanOrEqual(DEFAULT_CALENDAR_PAGE_SIZE);
    });

    it('walks the window across consecutive pages without gap or repeat', async () => {
      const { service } = buildService({ AAA: { provider: {}, tournaments: many(25) } });

      const seen: string[] = [];
      let offset = 0;
      for (;;) {
        const page: any = await service.getMyCalendars({ providerAbbr: 'AAA', limit: 10, offset }, superAdmin());
        seen.push(...page.calendars[0].tournaments.map((t: any) => t.tournamentId));
        if (!page.paging.hasMore) break;
        offset += page.paging.returned;
      }

      expect(seen).toHaveLength(25);
      expect(new Set(seen).size).toBe(25);
    });

    it('spans the window across multiple calendars in order', async () => {
      const { service } = buildService({
        AAA: { provider: {}, tournaments: many(3, PROVIDER_A) },
        BBB: { provider: {}, tournaments: many(3, PROVIDER_B) },
      });
      const member: UserContext = {
        ...providerAdmin(PROVIDER_A),
        providerRoles: { [PROVIDER_A]: 'PROVIDER_ADMIN', [PROVIDER_B]: 'PROVIDER_ADMIN' },
        providerIds: [PROVIDER_A, PROVIDER_B],
      };

      const result: any = await service.getMyCalendars({ limit: 4 }, member);

      expect(result.paging).toMatchObject({ total: 6, returned: 4, hasMore: true });
      expect(result.calendars[0].tournaments).toHaveLength(3);
      expect(result.calendars[1].tournaments).toHaveLength(1);
      // The calendar the window missed is still present, so it cannot vanish
      // from the UI mid-page.
      expect(result.calendars[1].providerAbbr).toBe('BBB');
    });
  });
});
