import { mocksEngine, tournamentEngineAsync, factoryConstants, readModel } from 'tods-competition-factory';

import { buildProjectionDeltas } from './buildProjectionDeltas';
import { buildRebuildIntents } from './rebuild';
import { ProjectionIntent } from './projectionTypes';
import { ProjectionDelta } from 'src/storage/interfaces/projection-outbox-storage.interface';

// ── In-memory delta reducer — mirrors the courthive-query consumer's apply
// semantics (upsert-by-PK with partial merge, update-by-key merge, delete-by-key)
// so we can compare the NET read-table state of two producer paths without a DB.
const PK: Record<string, string[]> = {
  tournaments: ['tournament_id'],
  events: ['event_id'],
  draws: ['draw_id'],
  structures: ['structure_id'],
  seeds: ['structure_id', 'seed_number'],
  match_ups: ['match_up_id'],
  match_up_competitors: ['match_up_id', 'side_number', 'competitor_index'],
  entries: ['tournament_id', 'event_id', 'participant_id'],
  venues: ['venue_id'],
  courts: ['court_id'],
  order_of_play: ['tournament_id'],
  scheduling_profile: ['tournament_id', 'schedule_date', 'venue_id', 'round_order'],
  participant_publish: ['tournament_id'],
  tournament_venues: ['tournament_id', 'venue_id'],
};

function keyString(table: string, row: Record<string, any>): string {
  return PK[table].map((c) => String(row[c])).join('|');
}

function matchesKey(row: Record<string, any>, key: Record<string, any>): boolean {
  return Object.entries(key).every(([k, v]) => row[k] === v);
}

function applyDeltas(deltas: ProjectionDelta[]): Record<string, Map<string, any>> {
  const tables: Record<string, Map<string, any>> = {};
  for (const d of deltas) {
    const t = (tables[d.table] ??= new Map());
    if (d.op === 'upsert' && d.row) {
      const pk = keyString(d.table, d.row);
      t.set(pk, { ...(t.get(pk) ?? {}), ...d.row });
    } else if (d.op === 'update' && d.row) {
      for (const [pk, row] of t) if (matchesKey(row, d.key)) t.set(pk, { ...row, ...d.row });
    } else if (d.op === 'delete') {
      for (const [pk, row] of [...t]) if (matchesKey(row, d.key)) t.delete(pk);
    }
  }
  return tables;
}

function snapshot(tables: Record<string, Map<string, any>>, name: string): any[] {
  return [...(tables[name]?.values() ?? [])].sort((a, b) => keyString(name, a).localeCompare(keyString(name, b)));
}

describe('projection conformance — incremental path ≡ rebuild path (byte-identical rows)', () => {
  async function flattenDrawOf(record: any) {
    return async (_tid: string, drawId: string) => {
      await tournamentEngineAsync.setState(record);
      const res: any = await tournamentEngineAsync.allDrawMatchUps({ drawId, inContext: true });
      return res?.matchUps ?? [];
    };
  }

  it('a completed tournament projects to the same match_ups + competitors + entries either way', async () => {
    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      drawProfiles: [{ drawSize: 8 }],
      completeAllMatchUps: true,
    });
    const tournamentId = tournamentRecord.tournamentId;
    // stamp a CANONICAL_PERSON claim on the first individual participant so the
    // claimPerson convergence is exercised too.
    const claimed = (tournamentRecord.participants ?? []).find((p: any) => p.participantType === 'INDIVIDUAL');
    claimed.person ??= {};
    claimed.person.personOtherIds = [{ organisationId: 'CANONICAL_PERSON', personId: 'canon-conf' }];

    const flattenDraw = await flattenDrawOf(tournamentRecord);
    const records = { [tournamentId]: tournamentRecord };

    // REBUILD path: full projection from the final record.
    const rebuildDeltas = await buildProjectionDeltas({
      intents: buildRebuildIntents(tournamentRecord),
      tournamentRecords: records,
      flattenDraw,
    });

    // INCREMENTAL path: the intents the producers accumulate over the tournament
    // lifecycle — draw flatten + a slim result update per completed matchUp +
    // participants/touch/venue/claim. Must converge to the same rows.
    const flatMatchUps = await flattenDraw(tournamentId, tournamentRecord.events[0].drawDefinitions[0].drawId);
    const incrementalIntents: ProjectionIntent[] = [
      { kind: 'touchTournament', tournamentId },
      { kind: 'participants', tournamentId },
      ...tournamentRecord.events.flatMap((e: any) =>
        (e.drawDefinitions ?? []).map(
          (d: any) => ({ kind: 'flattenDraw', tournamentId, drawId: d.drawId }) as ProjectionIntent,
        ),
      ),
      ...flatMatchUps
        .filter((m: any) => m.winningSide || m.matchUpStatus)
        .map((m: any) => ({ kind: 'matchUpResult', tournamentId, matchUp: m }) as ProjectionIntent),
      { kind: 'claimPerson', tournamentId, participantId: claimed.participantId, personId: 'canon-conf' },
    ];
    const incrementalDeltas = await buildProjectionDeltas({
      intents: incrementalIntents,
      tournamentRecords: records,
      flattenDraw,
    });

    const rebuilt = applyDeltas(rebuildDeltas);
    const incremental = applyDeltas(incrementalDeltas);

    for (const table of ['tournaments', 'match_ups', 'match_up_competitors', 'entries']) {
      expect(snapshot(incremental, table)).toEqual(snapshot(rebuilt, table));
    }
    // sanity: the tournament actually produced rows
    expect(snapshot(rebuilt, 'match_ups').length).toBeGreaterThan(0);
    expect(snapshot(rebuilt, 'match_up_competitors').some((r) => r.person_id === 'canon-conf')).toBe(true);
  });

  // Increment 6 (unblocked slice) — validate the read model's TEAMS / dual-match
  // handling (the S3 re-grain the whole schema exists for) against an ITA-shaped
  // college team-tennis tournament (TEAM event, COLLEGE tieFormat = singles +
  // doubles rubbers). This is the "ITA validation corpus" essence; the real
  // ingest harvest/feed is gated on CA decisions D2/D3/D4b.
  it('an ITA-shaped team-tennis dual match projects TIE/RUBBER/team_id/doubles rows — and incremental ≡ rebuild', async () => {
    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      drawProfiles: [
        { drawSize: 2, eventType: factoryConstants.eventConstants.TEAM, tieFormatName: 'COLLEGE_DEFAULT' },
      ],
      completeAllMatchUps: true,
    });
    const tournamentId = tournamentRecord.tournamentId;
    const drawId = tournamentRecord.events[0].drawDefinitions[0].drawId;
    const flattenDraw = await flattenDrawOf(tournamentRecord);
    const records = { [tournamentId]: tournamentRecord };

    const rebuildDeltas = await buildProjectionDeltas({
      intents: buildRebuildIntents(tournamentRecord),
      tournamentRecords: records,
      flattenDraw,
    });

    // incremental: draw flatten + a slim result per matchUp (team ties + rubbers).
    const teamMatchUps = await flattenDraw(tournamentId, drawId);
    const allMatchUps = [...teamMatchUps, ...teamMatchUps.flatMap((m: any) => m.tieMatchUps ?? [])];
    const incrementalIntents: ProjectionIntent[] = [
      { kind: 'touchTournament', tournamentId },
      { kind: 'participants', tournamentId },
      { kind: 'flattenDraw', tournamentId, drawId },
      ...allMatchUps
        .filter((m: any) => m.winningSide || m.matchUpStatus)
        .map((m: any) => ({ kind: 'matchUpResult', tournamentId, matchUp: m }) as ProjectionIntent),
    ];
    const incrementalDeltas = await buildProjectionDeltas({
      intents: incrementalIntents,
      tournamentRecords: records,
      flattenDraw,
    });

    const rebuilt = applyDeltas(rebuildDeltas);
    const incremental = applyDeltas(incrementalDeltas);
    for (const table of ['match_ups', 'match_up_competitors', 'entries']) {
      expect(snapshot(incremental, table)).toEqual(snapshot(rebuilt, table));
    }

    // team-structure shape assertions on the rebuilt rows
    const matchUps = snapshot(rebuilt, 'match_ups');
    const tie = matchUps.find((r) => r.match_up_level === 'TIE');
    const rubbers = matchUps.filter((r) => r.match_up_level === 'RUBBER');
    expect(tie).toMatchObject({ event_type: 'TEAM', parent_match_up_id: null });
    expect(rubbers.length).toBeGreaterThan(0);
    expect(rubbers.every((r) => r.parent_match_up_id === tie!.match_up_id && r.collection_id)).toBe(true);

    const competitors = snapshot(rebuilt, 'match_up_competitors');
    // rubber competitor rows carry a team_id (the dual's team) — enables GROUP BY team_id
    const rubberIds = new Set(rubbers.map((r) => r.match_up_id));
    const rubberCompetitors = competitors.filter((c) => rubberIds.has(c.match_up_id));
    expect(rubberCompetitors.length).toBeGreaterThan(0);
    expect(rubberCompetitors.every((c) => c.team_id)).toBe(true);
    // at least one DOUBLES rubber → two per-individual (PAIR) competitor rows on a side
    const doublesRubber = rubbers.find((r) => r.event_type === 'DOUBLES');
    if (doublesRubber) {
      const side1 = competitors.filter((c) => c.match_up_id === doublesRubber.match_up_id && c.side_number === 1);
      expect(side1.length).toBe(2);
      expect(side1.every((c) => c.participant_type === 'PAIR')).toBe(true);
    }
  });

  // The anti-divergence capstone: the CFS incremental/rebuild producer and the
  // factory `cast()` (full-record projection) now share the SAME read-model
  // builders, so a from-scratch rebuild must equal cast() byte-for-byte. Uses a
  // record with NO canonical self-claims so the CFS-only `claimPerson`
  // reconciliation (which cast() intentionally does not do) stays empty.
  it('CFS rebuild ≡ factory cast() (single source of truth, no divergence)', async () => {
    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      drawProfiles: [
        { drawSize: 8, seedsCount: 4, eventName: 'Singles' },
        {
          drawSize: 2,
          eventType: factoryConstants.eventConstants.TEAM,
          tieFormatName: 'COLLEGE_DEFAULT',
          eventName: 'Teams',
        },
      ],
      venueProfiles: [{ venueId: 'v1', venueName: 'Club', courtsCount: 4, idPrefix: 'v1c' }],
      completeAllMatchUps: true,
    });
    const tournamentId = tournamentRecord.tournamentId;
    // publish the order of play + set a scheduling plan so both schedule tables are exercised
    const draw = tournamentRecord.events[0].drawDefinitions[0];
    tournamentRecord.timeItems = [
      {
        itemType: 'PUBLISH.STATUS',
        itemValue: { PUBLIC: { orderOfPlay: { published: true, scheduledDates: ['2025-01-05'] }, participants: { published: true } } },
      },
    ];
    tournamentRecord.scheduling = {
      profile: [
        {
          scheduleDate: '2025-01-05',
          venues: [
            {
              venueId: 'v1',
              rounds: [
                { eventId: tournamentRecord.events[0].eventId, drawId: draw.drawId, structureId: draw.structures[0].structureId, roundNumber: 1 },
              ],
            },
          ],
        },
      ],
    };
    const flattenDraw = await flattenDrawOf(tournamentRecord);
    const records = { [tournamentId]: tournamentRecord };

    const rebuiltDeltas = await buildProjectionDeltas({
      intents: buildRebuildIntents(tournamentRecord),
      tournamentRecords: records,
      flattenDraw,
    });
    const rebuilt = applyDeltas(rebuiltDeltas);

    const castRows: any = readModel.cast({ tournamentRecord }).rows;
    const castSnapshot = (table: string) =>
      [...(castRows[table] ?? [])].sort((a: any, b: any) => keyString(table, a).localeCompare(keyString(table, b)));

    for (const table of [
      'tournaments',
      'events',
      'draws',
      'structures',
      'seeds',
      'match_ups',
      'match_up_competitors',
      'entries',
      'venues',
      'courts',
      'order_of_play',
      'scheduling_profile',
      'participant_publish',
      'tournament_venues',
    ]) {
      expect(snapshot(rebuilt, table)).toEqual(castSnapshot(table));
    }
    expect(castSnapshot('seeds').length).toBeGreaterThan(0); // seedsCount:4 above must produce rows
    expect(castSnapshot('draws').length).toBeGreaterThan(0);
    expect(castSnapshot('structures').length).toBeGreaterThan(0);
    expect(castSnapshot('courts').length).toBeGreaterThan(0); // venueProfiles courtsCount:4 above
    expect(castSnapshot('participant_publish')).toEqual([{ tournament_id: tournamentId, published: true, embargo: null }]);
    expect(castSnapshot('tournaments')[0].published).toBe(true); // OoP + participants published above
    expect(castSnapshot('order_of_play')).toEqual([
      { tournament_id: tournamentId, published: true, scheduled_dates: ['2025-01-05'], event_ids: null, embargo: null },
    ]);
    expect(castSnapshot('scheduling_profile').length).toBeGreaterThan(0);
    expect(castSnapshot('match_ups').length).toBeGreaterThan(0);
    expect(castSnapshot('tournament_venues')).toEqual([{ tournament_id: tournamentId, venue_id: 'v1' }]);
  });

  // Removal / stale-row regression: an entry set can SHRINK while the participant
  // record is KEPT (removeEventEntries / a withdrawal), which fires MODIFY_EVENT_ENTRIES
  // (an `entries` intent) but NO deleteParticipants/deleteEvent. entryDeltas must
  // delete-by-tournament + re-insert, else the removed entry survives as a stale row.
  // The single-final-state capstone cannot see this (it starts from an empty table), so
  // this drives TWO cycles against the SAME long-lived table set.
  it('removeEventEntries (participant kept) leaves no stale entries row — incremental converges to cast()', async () => {
    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      drawProfiles: [{ drawSize: 8, eventName: 'Singles' }],
    });
    const tournamentId = tournamentRecord.tournamentId;
    const flattenDraw = await flattenDrawOf(tournamentRecord);
    const records = { [tournamentId]: tournamentRecord };

    // CYCLE 1 — full projection of the initial 8-entry state.
    const initialDeltas = await buildProjectionDeltas({
      intents: buildRebuildIntents(tournamentRecord),
      tournamentRecords: records,
      flattenDraw,
    });

    const event = tournamentRecord.events[0];
    const initialEntryCount = event.entries.length;
    expect(initialEntryCount).toBeGreaterThan(1);
    const removed = event.entries[0];

    // Remove ONE event entry but KEEP the participant record (the removeEventEntries shape).
    event.entries = event.entries.slice(1);
    expect(tournamentRecord.participants.some((p: any) => p.participantId === removed.participantId)).toBe(true);

    // CYCLE 2 — the producer's response to MODIFY_EVENT_ENTRIES is a single `entries` intent.
    const incrementalDeltas = await buildProjectionDeltas({
      intents: [{ kind: 'entries', tournamentId }],
      tournamentRecords: records,
      flattenDraw,
    });

    // Both cycles apply to the SAME table set (the read model is long-lived).
    const tables = applyDeltas([...initialDeltas, ...incrementalDeltas]);
    const entries = snapshot(tables, 'entries');

    // cast() of the FINAL record is the direct-re-query oracle.
    const castRows: any = readModel.cast({ tournamentRecord }).rows;
    const castEntries = [...(castRows.entries ?? [])].sort((a: any, b: any) =>
      keyString('entries', a).localeCompare(keyString('entries', b)),
    );

    expect(entries).toEqual(castEntries); // no stale row survives the removal
    expect(entries.length).toBe(initialEntryCount - 1);
    expect(entries.some((r) => r.participant_id === removed.participantId)).toBe(false);
  });
});
