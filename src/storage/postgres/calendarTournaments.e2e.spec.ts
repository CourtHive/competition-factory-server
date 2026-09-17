import { Pool } from 'pg';

import { buildCalendarScope } from 'src/modules/factory/helpers/checkTournamentAccess';
import { PostgresCalendarStorage } from './postgres-calendar.storage';
import { publicCalendarEntry } from 'src/modules/providers/helpers/publicCalendarEntry';
import { toRow } from './calendarTournamentRow';

/**
 * `calendar_tournaments` against a REAL Postgres (migration 047).
 *
 * ## Why this exists
 *
 * Every other storage spec in this repo mocks the pool, so the SQL string is never executed
 * — a query can be syntactically broken, reference a dropped column, or silently return the
 * wrong rows, and the unit suite stays green. The calendar's authorization now lives IN that
 * SQL, so "the predicate is right" and "the predicate runs" became the same question.
 *
 * `InMemoryCalendarStorage` mirrors `buildWhere` for the unit tests and
 * `calendarScopeParity.spec.ts` pins that mirror against `scopeCalendarForUser`. Neither can
 * catch a malformed statement. This can.
 *
 * Opt-in, following `projection-verify.e2e.spec.ts`: excluded from `pnpm test:unit`, and
 * skipped unless CALENDAR_DB_TESTS=true, because CI has no Postgres.
 *
 *   CALENDAR_DB_TESTS=true PGGSSENCMODE=disable pnpm test -- calendarTournaments
 *
 * It creates and drops its OWN table in a scratch schema, so it never touches a real
 * calendar.
 */

const RUN = process.env.CALENDAR_DB_TESTS === 'true';
const d = RUN ? describe : describe.skip;

const P_ADMIN = 'p-admin';
const P_DIRECTOR = 'p-director';
const ME = 'user-me';

function entry(tournamentId: string, providerId: string, overrides: any = {}) {
  return {
    tournamentId,
    providerId,
    searchText: tournamentId,
    published: true,
    tournament: { tournamentId, tournamentName: tournamentId, startDate: '2026-05-01' },
    ...overrides,
  };
}

d('calendar_tournaments (real Postgres)', () => {
  let pool: Pool;
  let storage: PostgresCalendarStorage;

  beforeAll(async () => {
    pool = new Pool({
      host: process.env.PG_HOST || 'localhost',
      port: Number(process.env.PG_PORT) || 5432,
      user: process.env.PG_USER || process.env.USER,
      password: process.env.PG_PASSWORD || '',
      database: process.env.PG_DATABASE || 'courthive',
    });
    // Own schema, so a real `calendar_tournaments` is never in reach.
    await pool.query('CREATE SCHEMA IF NOT EXISTS calendar_047_test');
    await pool.query('SET search_path TO calendar_047_test, public');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS calendar_047_test.calendar_tournaments (
        tournament_id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, provider_abbr TEXT,
        tournament_name TEXT, search_text TEXT NOT NULL DEFAULT '', start_date DATE, end_date DATE,
        tournament_status TEXT, published BOOLEAN NOT NULL DEFAULT FALSE, event_count INTEGER,
        offline BOOLEAN, created_by_user_id TEXT, row_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        tournament_image_url TEXT, identity JSONB, online_resources JSONB, event_info JSONB,
        venues JSONB, registration_profile JSONB, tournament_contacts JSONB, tournament_address JSONB,
        publish_state JSONB, time_items JSONB, notes TEXT, remainder JSONB)`);
    storage = new PostgresCalendarStorage(pool as any);
  });

  beforeEach(async () => {
    await pool.query('SET search_path TO calendar_047_test, public');
    await pool.query('TRUNCATE calendar_047_test.calendar_tournaments');
  });

  afterAll(async () => {
    await pool.query('DROP SCHEMA IF EXISTS calendar_047_test CASCADE');
    await pool.end();
  });

  const seed = async (entries: any[]) => {
    for (const e of entries) await storage.upsertTournament(toRow(e, e.providerId, 'ABBR'));
  };

  const unrestricted = { unrestricted: true, fullAccessProviderIds: [], directorProviderIds: [], assignedTournamentIds: [] };

  it('round-trips an entry through real SQL, unchanged', async () => {
    const original = entry('t-1', P_ADMIN, {
      tournament: {
        tournamentId: 't-1',
        tournamentName: 'Wimbledon',
        startDate: '2026-06-29',
        endDate: '2026-07-12',
        venues: [{ venueId: 'v1' }],
        registrationProfile: { entryFees: [{ amount: 50 }] },
        eventInfo: [{ eventId: 'e1', eventName: 'MS' }],
        publishState: { status: { published: true, publishedEventIds: ['e1'] } },
        timeItemValues: {},
      },
      createdByUserId: ME,
    });
    await seed([original]);

    expect(await storage.getTournament('t-1')).toEqual(original);
  });

  it('relocates the row on a provider move — no second copy, no sweep', async () => {
    await seed([entry('t-move', P_DIRECTOR), entry('t-stay', P_DIRECTOR)]);
    await storage.upsertTournament(toRow(entry('t-move', P_ADMIN), P_ADMIN, 'ABBR'));

    expect((await storage.getTournament('t-move')).providerId).toBe(P_ADMIN);
    expect(await storage.listProviderTournaments(P_DIRECTOR)).toHaveLength(1);
    expect(await storage.listProviderTournaments(P_ADMIN)).toHaveLength(1);
  });

  it('applies DIRECTOR scoping in SQL — own or assigned, never a peer’s', async () => {
    await seed([
      entry('t-own', P_DIRECTOR, { createdByUserId: ME }),
      entry('t-assigned', P_DIRECTOR, { createdByUserId: 'someone' }),
      entry('t-peer', P_DIRECTOR, { createdByUserId: 'someone' }),
    ]);

    const scope = buildCalendarScope(
      {
        userId: ME, email: 'me@test', isSuperAdmin: false, globalRoles: ['CLIENT'],
        providerRoles: { [P_DIRECTOR]: 'DIRECTOR' }, providerIds: [P_DIRECTOR],
      } as any,
      new Set(['t-assigned']),
    );

    const { rows, total } = await storage.queryTournaments({
      providerIds: [P_DIRECTOR], scope, limit: 50, offset: 0,
    });

    expect(rows.map((r) => r.tournamentId).sort()).toEqual(['t-assigned', 't-own']);
    expect(total).toBe(2);
  });

  it('returns NOTHING for an empty provider list — the 2026-09-15 shape', async () => {
    await seed([entry('t-1', P_ADMIN)]);
    const result = await storage.queryTournaments({ providerIds: [], scope: unrestricted, limit: 50, offset: 0 });
    expect(result).toEqual({ rows: [], total: 0, totalsByProvider: {} });
  });

  it('filters unpublished rows on the public surface', async () => {
    await seed([entry('t-pub', P_ADMIN), entry('t-draft', P_ADMIN, { published: false })]);

    const { rows } = await storage.queryTournaments({
      providerIds: [P_ADMIN], scope: unrestricted, publishedOnly: true, limit: 50, offset: 0,
    });

    expect(rows.map((r) => r.tournamentId)).toEqual(['t-pub']);
  });

  it('pages without repeating or skipping, even when start_date is NULL', async () => {
    // The ORDER BY tiebreaker exists for this: start_date is neither unique nor non-null.
    await seed([
      entry('t-a', P_ADMIN, { tournament: { tournamentId: 't-a', startDate: '2026-05-01' } }),
      entry('t-b', P_ADMIN, { tournament: { tournamentId: 't-b', startDate: '2026-05-01' } }),
      entry('t-c', P_ADMIN, { tournament: { tournamentId: 't-c' } }),
      entry('t-d', P_ADMIN, { tournament: { tournamentId: 't-d', startDate: '2026-05-01' } }),
    ]);

    const seen: string[] = [];
    let offset = 0;
    for (;;) {
      const { rows, total } = await storage.queryTournaments({
        providerIds: [P_ADMIN], scope: unrestricted, limit: 2, offset,
      });
      seen.push(...rows.map((r) => r.tournamentId));
      offset += rows.length;
      if (offset >= total || !rows.length) break;
    }

    expect(seen).toHaveLength(4);
    expect(new Set(seen).size).toBe(4);
  });

  it('reports per-provider totals alongside the grand total', async () => {
    await seed([entry('t-1', P_ADMIN), entry('t-2', P_ADMIN), entry('t-3', P_DIRECTOR)]);

    const { total, totalsByProvider } = await storage.queryTournaments({
      providerIds: [P_ADMIN, P_DIRECTOR], scope: unrestricted, limit: 1, offset: 0,
    });

    expect(total).toBe(3);
    expect(totalsByProvider).toEqual({ [P_ADMIN]: 2, [P_DIRECTOR]: 1 });
  });

  it('serves only published events through the public projection, end to end', async () => {
    // The whole path: write a row with a published and an unpublished event, read it back
    // through real SQL, project it for an anonymous caller.
    await seed([
      entry('t-1', P_ADMIN, {
        tournament: {
          tournamentId: 't-1',
          tournamentName: 'Open',
          eventInfo: [
            { eventId: 'e-pub', eventName: 'Published', notes: 'operator' },
            { eventId: 'e-draft', eventName: 'Draft', notes: 'operator' },
          ],
          publishState: { status: { published: true, publishedEventIds: ['e-pub'] } },
        },
      }),
    ]);

    const { rows } = await storage.queryTournaments({
      providerIds: [P_ADMIN], scope: unrestricted, publishedOnly: true, limit: 50, offset: 0,
    });

    // Stored: both events. Served: one.
    expect(rows[0].tournament.eventInfo).toHaveLength(2);
    const projected = publicCalendarEntry(rows[0]);
    expect(projected.tournament.eventInfo.map((e: any) => e.eventId)).toEqual(['e-pub']);
    expect(projected.tournament.eventInfo[0]).not.toHaveProperty('notes');
  });

  it('removes by primary key without touching siblings', async () => {
    await seed([entry('t-1', P_ADMIN), entry('t-2', P_ADMIN)]);
    await storage.removeTournament('t-1');

    expect(await storage.getTournament('t-1')).toBeNull();
    expect(await storage.listProviderTournaments(P_ADMIN)).toHaveLength(1);
  });
});
