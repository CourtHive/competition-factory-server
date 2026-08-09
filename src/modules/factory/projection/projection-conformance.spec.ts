import {
  mocksEngine,
  tournamentEngineAsync,
  factoryConstants,
  globalState,
  readModel,
  topicConstants,
} from 'tods-competition-factory';

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

/**
 * FK cascades the REAL schema performs but a naive in-memory reducer would not, so the
 * producer legitimately emits no explicit delete for the child. Mirrors the ON DELETE
 * CASCADE constraints in courthive-query's migrations; child → (parent table, join column).
 *
 * Without this the harness reports false positives — a deleteEvent emits a query_draws
 * delete and lets query_structures.draw_id cascade, which reads as an orphan here while
 * being perfectly correct in Postgres. Getting that wrong in the other direction is worse:
 * a cascade modelled here that the schema does NOT have would hide a real orphan, so this
 * map must track the migrations exactly.
 */
const FK_CASCADES: Array<{ child: string; parent: string; column: string }> = [
  { child: 'structures', parent: 'draws', column: 'draw_id' },
  { child: 'match_up_competitors', parent: 'match_ups', column: 'match_up_id' },
  { child: 'courts', parent: 'venues', column: 'venue_id' },
];

function applyFkCascades(tables: Record<string, Map<string, any>>): void {
  // repeat to a fixed point: draws -> structures could later feed another level
  let changed = true;
  while (changed) {
    changed = false;
    for (const { child, parent, column } of FK_CASCADES) {
      const childRows = tables[child];
      const parentRows = tables[parent];
      if (!childRows || !parentRows) continue;
      const live = new Set([...parentRows.values()].map((r: any) => r[column]));
      for (const [pk, row] of [...childRows]) {
        if (row[column] !== undefined && row[column] !== null && !live.has(row[column])) {
          childRows.delete(pk);
          changed = true;
        }
      }
    }
  }
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
  applyFkCascades(tables);
  return tables;
}

function snapshot(tables: Record<string, Map<string, any>>, name: string): any[] {
  return [...(tables[name]?.values() ?? [])].sort((a, b) => keyString(name, a).localeCompare(keyString(name, b)));
}

/**
 * Does the LINKED factory build project bracket topology (winner/loser progression edges
 * + round_position)? Those columns arrive with an unreleased factory, and CI installs the
 * PUBLISHED package — so the cases that assert them SKIP rather than fail until the pin
 * catches up. Detected from cast() output rather than a version string, so it activates
 * automatically on the bump with nothing to remember to flip.
 */
const factoryProjectsBracketTopology = (() => {
  const { tournamentRecord } = mocksEngine.generateTournamentRecord({
    drawProfiles: [{ drawSize: 4 }],
  });
  const row: any = (readModel.cast({ tournamentRecord })?.rows as any)?.match_ups?.[0] ?? {};
  return 'winner_match_up_id' in row && 'round_position' in row;
})();
const itWithBracketTopology = factoryProjectsBracketTopology ? it : it.skip;

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
        itemValue: {
          PUBLIC: {
            orderOfPlay: { published: true, scheduledDates: ['2025-01-05'] },
            participants: { published: true },
          },
        },
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
                {
                  eventId: tournamentRecord.events[0].eventId,
                  drawId: draw.drawId,
                  structureId: draw.structures[0].structureId,
                  roundNumber: 1,
                },
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
    expect(castSnapshot('participant_publish')).toEqual([
      { tournament_id: tournamentId, published: true, embargo: null },
    ]);
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

  // removeStructure deletes the playoff's matchUps AND strips loserMatchUpId from the
  // surviving matchUps that fed it. Those edges are projected columns as of factory
  // `feat(readModel): project draw-progression edges`, so a missed rewire is a stale row.
  // The producer path is: DELETED_MATCHUP_IDS -> deleteMatchUps, MODIFY_DRAW_DEFINITION ->
  // draw, and (the fix) MODIFY_MATCHUP per rewired matchUp -> matchUpResult. This asserts
  // the incremental result converges to cast() — i.e. no surviving row keeps a
  // loser_match_up_id pointing at a deleted matchUp.
  itWithBracketTopology(
    'removeStructure: incremental match_ups converge to cast() with no dangling progression edge',
    async () => {
      const { tournamentRecord } = mocksEngine.generateTournamentRecord({
        drawProfiles: [{ drawSize: 32, eventName: 'Singles' }],
        completeAllMatchUps: true,
      });
      const tournamentId = tournamentRecord.tournamentId;
      const records = { [tournamentId]: tournamentRecord };
      await tournamentEngineAsync.setState(tournamentRecord);

      const drawId = tournamentRecord.events[0].drawDefinitions[0].drawId;
      const structureId = tournamentRecord.events[0].drawDefinitions[0].structures[0].structureId;
      const added = await tournamentEngineAsync.addPlayoffStructures({
        playoffStructureNameBase: 'Playoff',
        roundProfiles: [{ 3: 1 }],
        structureId,
        drawId,
      });
      expect(added.success).toEqual(true);

      const withPlayoff = (await tournamentEngineAsync.getTournament()).tournamentRecord;
      const edgesOf = (record: any) =>
        new Map<string, string>(
          (record.events ?? [])
            .flatMap((e: any) => e.drawDefinitions ?? [])
            .flatMap((d: any) => d.structures ?? [])
            .flatMap((st: any) => st.matchUps ?? [])
            .map((m: any) => [m.matchUpId, `${m.winnerMatchUpId ?? ''}|${m.loserMatchUpId ?? ''}`]),
        );
      const edgesBefore = edgesOf(withPlayoff);
      const initialDeltas = await buildProjectionDeltas({
        intents: buildRebuildIntents(withPlayoff),
        tournamentRecords: { [tournamentId]: withPlayoff },
        flattenDraw: await flattenDrawOf(withPlayoff),
      });

      const playoffStructureId = (await tournamentEngineAsync.getEvent({ drawId })).drawDefinition.structures.find(
        (st: any) => st.structureId !== structureId,
      ).structureId;
      const removal = await tournamentEngineAsync.removeStructure({ structureId: playoffStructureId, drawId });
      expect(removal.success).toEqual(true);

      const finalRecord = (await tournamentEngineAsync.getTournament()).tournamentRecord;
      records[tournamentId] = finalRecord;

      // What the fixed factory dispatches: the deletes, the draw, and a MODIFY_MATCHUP per
      // rewired matchUp. `matchUpResult` is what recordMatchUpResult pushes for that topic.
      // The rewired set is derived by diffing the stored edges — the same set the factory
      // fix notices — rather than hand-listed, so this cannot drift from the implementation.
      const edgesAfter = edgesOf(finalRecord);
      const rewired = (finalRecord.events ?? [])
        .flatMap((e: any) => e.drawDefinitions ?? [])
        .flatMap((d: any) => d.structures ?? [])
        .flatMap((st: any) => st.matchUps ?? [])
        .filter((m: any) => edgesBefore.get(m.matchUpId) !== edgesAfter.get(m.matchUpId));
      expect(rewired.length).toBeGreaterThan(0); // the scenario must actually rewire something
      const incrementalDeltas = await buildProjectionDeltas({
        intents: [
          { kind: 'deleteMatchUps', tournamentId, matchUpIds: removal.removedMatchUpIds },
          { kind: 'draw', tournamentId, drawId },
          ...rewired.map((m: any) => ({ kind: 'matchUpResult' as const, tournamentId, matchUp: m })),
        ],
        tournamentRecords: records,
        flattenDraw: await flattenDrawOf(finalRecord),
      });

      const tables = applyDeltas([...initialDeltas, ...incrementalDeltas]);
      const matchUps = snapshot(tables, 'match_ups');
      const surviving = new Set(matchUps.map((r: any) => r.match_up_id));

      // no surviving row may point at a matchUp that no longer exists
      for (const row of matchUps) {
        if (row.loser_match_up_id) expect(surviving.has(row.loser_match_up_id)).toBe(true);
        if (row.winner_match_up_id) expect(surviving.has(row.winner_match_up_id)).toBe(true);
      }
      expect(removal.removedMatchUpIds.length).toBeGreaterThan(0);
      expect(matchUps.some((r: any) => removal.removedMatchUpIds.includes(r.match_up_id))).toBe(false);
    },
  );

  // Publishing event seeding flips getEventPublishStatus → cast() marks events.published
  // true, but publishEventSeeding dispatches only PUBLISH_EVENT_SEEDING. That topic is now
  // subscribed to recordEvents; this asserts the incremental events row matches cast() for
  // the seeding-published state (an unsubscribed topic would leave query_events.published stale).
  // ── narrow-intent coverage ────────────────────────────────────────────────
  // The failure mode these exist for: a topic IS subscribed and an intent IS pushed, but
  // the intent expands to a re-projection too narrow to carry the change. That gap is
  // invisible to factory's notice-conformance oracles, which check the notice stream
  // rather than the consumer's topic→row mapping — it is exactly how the MODIFY_MATCHUP
  // slim-row miss reached main earlier in this workstream.

  it('MODIFY_PARTICIPANTS rename: competitor participant_name converges to cast()', async () => {
    // recordParticipants pushes {kind:'participants'}, which re-projects ONLY the entries
    // table — match_up_competitors.participant_name is otherwise written exclusively by
    // the draw-scoped flatten. The participantName intent is what closes that.
    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      drawProfiles: [{ drawSize: 8, eventName: 'Singles' }],
      completeAllMatchUps: true,
    });
    const tournamentId = tournamentRecord.tournamentId;
    const records = { [tournamentId]: tournamentRecord };
    const initialDeltas = await buildProjectionDeltas({
      intents: buildRebuildIntents(tournamentRecord),
      tournamentRecords: records,
      flattenDraw: await flattenDrawOf(tournamentRecord),
    });

    const target = tournamentRecord.participants.find((p: any) => p.participantType === 'INDIVIDUAL');
    expect(target).toBeDefined();
    target.participantName = 'Renamed Competitor';
    if (target.person) target.person.standardFamilyName = 'Competitor';

    const incrementalDeltas = await buildProjectionDeltas({
      intents: [
        { kind: 'participants', tournamentId },
        {
          kind: 'participantName',
          tournamentId,
          participantId: target.participantId,
          participantName: target.participantName,
        },
      ],
      tournamentRecords: records,
      flattenDraw: await flattenDrawOf(tournamentRecord),
    });

    const tables = applyDeltas([...initialDeltas, ...incrementalDeltas]);
    const competitors = snapshot(tables, 'match_up_competitors');
    const castRows: any = readModel.cast({ tournamentRecord }).rows;
    const castCompetitors = [...(castRows.match_up_competitors ?? [])].sort((a: any, b: any) =>
      keyString('match_up_competitors', a).localeCompare(keyString('match_up_competitors', b)),
    );

    const renamedRows = competitors.filter((r) => r.individual_participant_id === target.participantId);
    expect(renamedRows.length).toBeGreaterThan(0); // the participant must actually compete
    expect(renamedRows.every((r) => r.participant_name === 'Renamed Competitor')).toBe(true);
    expect(competitors).toEqual(castCompetitors);
  });

  it('MODIFY_TOURNAMENT_DETAIL: touchTournament carries the renamed tournaments row', async () => {
    // touchTournament is the narrowest intent in the map — one row, no children. If it
    // did not re-read the record the tournaments row would keep the pre-mutation name.
    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      drawProfiles: [{ drawSize: 4, eventName: 'Singles' }],
    });
    const tournamentId = tournamentRecord.tournamentId;
    const records = { [tournamentId]: tournamentRecord };
    const initialDeltas = await buildProjectionDeltas({
      intents: buildRebuildIntents(tournamentRecord),
      tournamentRecords: records,
      flattenDraw: await flattenDrawOf(tournamentRecord),
    });

    tournamentRecord.tournamentName = 'Renamed Championships';
    const incrementalDeltas = await buildProjectionDeltas({
      intents: [{ kind: 'touchTournament', tournamentId }],
      tournamentRecords: records,
      flattenDraw: await flattenDrawOf(tournamentRecord),
    });

    const tables = applyDeltas([...initialDeltas, ...incrementalDeltas]);
    const castRows: any = readModel.cast({ tournamentRecord }).rows;
    expect(snapshot(tables, 'tournaments')).toEqual(castRows.tournaments);
    expect(snapshot(tables, 'tournaments')[0].tournament_name).toEqual('Renamed Championships');
  });

  it('MODIFY_SEED_ASSIGNMENTS: the seeds intent re-projects a changed seed to match cast()', async () => {
    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      drawProfiles: [{ drawSize: 8, seedsCount: 4, eventName: 'Singles' }],
    });
    const tournamentId = tournamentRecord.tournamentId;
    const records = { [tournamentId]: tournamentRecord };
    const initialDeltas = await buildProjectionDeltas({
      intents: buildRebuildIntents(tournamentRecord),
      tournamentRecords: records,
      flattenDraw: await flattenDrawOf(tournamentRecord),
    });

    const structure = tournamentRecord.events[0].drawDefinitions[0].structures[0];
    const assignment = (structure.seedAssignments ?? []).find((a: any) => a.participantId);
    expect(assignment).toBeDefined();
    // move the seed to a different entered participant (the shape of a seed reassignment)
    const otherEntry = tournamentRecord.events[0].entries.find(
      (e: any) => e.participantId !== assignment.participantId,
    );
    expect(otherEntry).toBeDefined();
    assignment.participantId = otherEntry.participantId;

    const incrementalDeltas = await buildProjectionDeltas({
      intents: [{ kind: 'seeds', tournamentId, structureId: structure.structureId }],
      tournamentRecords: records,
      flattenDraw: await flattenDrawOf(tournamentRecord),
    });

    const tables = applyDeltas([...initialDeltas, ...incrementalDeltas]);
    const castRows: any = readModel.cast({ tournamentRecord }).rows;
    const castSeeds = [...(castRows.seeds ?? [])].sort((a: any, b: any) =>
      keyString('seeds', a).localeCompare(keyString('seeds', b)),
    );
    expect(snapshot(tables, 'seeds')).toEqual(castSeeds);
  });

  it('DELETE_EVENT: the cascade leaves no orphaned match_ups, entries, draws or structures', async () => {
    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      eventProfiles: [
        { eventName: 'Keep', drawProfiles: [{ drawSize: 8 }] },
        { eventName: 'Drop', drawProfiles: [{ drawSize: 8 }] },
      ],
    });
    const tournamentId = tournamentRecord.tournamentId;
    const records = { [tournamentId]: tournamentRecord };
    const initialDeltas = await buildProjectionDeltas({
      intents: buildRebuildIntents(tournamentRecord),
      tournamentRecords: records,
      flattenDraw: await flattenDrawOf(tournamentRecord),
    });

    const dropped = tournamentRecord.events.find((e: any) => e.eventName === 'Drop');
    expect(dropped).toBeDefined();
    const droppedEventId = dropped.eventId;
    tournamentRecord.events = tournamentRecord.events.filter((e: any) => e.eventId !== droppedEventId);

    const incrementalDeltas = await buildProjectionDeltas({
      intents: [{ kind: 'deleteEvent', tournamentId, eventId: droppedEventId }],
      tournamentRecords: records,
      flattenDraw: await flattenDrawOf(tournamentRecord),
    });

    const tables = applyDeltas([...initialDeltas, ...incrementalDeltas]);
    for (const table of ['match_ups', 'entries', 'draws', 'structures']) {
      const orphans = snapshot(tables, table).filter((r: any) => r.event_id === droppedEventId);
      expect({ table, orphans: orphans.length }).toEqual({ table, orphans: 0 });
    }
    // the surviving event is untouched
    expect(snapshot(tables, 'events').length).toBe(1);
  });

  it('MODIFY_VENUE: the venue intent re-projects venues + courts to match cast()', async () => {
    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      drawProfiles: [{ drawSize: 4, eventName: 'Singles' }],
      venueProfiles: [{ venueName: 'Center', courtsCount: 3 }],
    });
    const tournamentId = tournamentRecord.tournamentId;
    const records = { [tournamentId]: tournamentRecord };
    const initialDeltas = await buildProjectionDeltas({
      intents: buildRebuildIntents(tournamentRecord),
      tournamentRecords: records,
      flattenDraw: await flattenDrawOf(tournamentRecord),
    });

    const venue = tournamentRecord.venues[0];
    venue.venueName = 'Renamed Venue';
    venue.courts[0].courtName = 'Renamed Court';

    const incrementalDeltas = await buildProjectionDeltas({
      intents: [{ kind: 'venue', tournamentId, venue }],
      tournamentRecords: records,
      flattenDraw: await flattenDrawOf(tournamentRecord),
    });

    const tables = applyDeltas([...initialDeltas, ...incrementalDeltas]);
    const castRows: any = readModel.cast({ tournamentRecord }).rows;
    const sortBy = (name: string, rows: any[]) =>
      [...rows].sort((a, b) => keyString(name, a).localeCompare(keyString(name, b)));
    expect(snapshot(tables, 'venues')).toEqual(sortBy('venues', castRows.venues ?? []));
    expect(snapshot(tables, 'courts')).toEqual(sortBy('courts', castRows.courts ?? []));
    expect(snapshot(tables, 'courts').some((r: any) => r.court_name === 'Renamed Court')).toBe(true);
  });

  it('DELETE_VENUE drops only the tournament link — venue + courts are RETAINED by design', async () => {
    // This is the one place the read model is deliberately NOT cast()-equal. Venues may be
    // shared across tournaments, so DELETE_VENUE removes the tournament_venues link and
    // leaves query_venues (and its courts, which FK-cascade from it) in place —
    // documented in migration 009. Pinned so nobody "fixes" it into an equality later.
    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      drawProfiles: [{ drawSize: 4, eventName: 'Singles' }],
      venueProfiles: [{ venueName: 'Center', courtsCount: 2 }],
    });
    const tournamentId = tournamentRecord.tournamentId;
    const records = { [tournamentId]: tournamentRecord };
    const venueId = tournamentRecord.venues[0].venueId;
    const initialDeltas = await buildProjectionDeltas({
      intents: buildRebuildIntents(tournamentRecord),
      tournamentRecords: records,
      flattenDraw: await flattenDrawOf(tournamentRecord),
    });

    tournamentRecord.venues = [];
    const incrementalDeltas = await buildProjectionDeltas({
      intents: [{ kind: 'deleteVenue', tournamentId, venueId }],
      tournamentRecords: records,
      flattenDraw: await flattenDrawOf(tournamentRecord),
    });

    const tables = applyDeltas([...initialDeltas, ...incrementalDeltas]);
    expect(snapshot(tables, 'tournament_venues')).toEqual([]); // link dropped
    expect(snapshot(tables, 'venues').map((r: any) => r.venue_id)).toEqual([venueId]); // retained
    expect(snapshot(tables, 'courts').length).toBe(2); // retained with their venue

    // …and cast() of the venue-less record genuinely disagrees. Asserting the divergence
    // rather than glossing it keeps the exception honest.
    const castRows: any = readModel.cast({ tournamentRecord }).rows;
    expect(castRows.venues ?? []).toEqual([]);
  });

  it('DELETE_PARTICIPANTS: the entries-only intent is safe BECAUSE factory blocks deleting a competitor', async () => {
    // recordDeleteParticipants pushes an intent that deletes entries rows only. Nothing
    // clears match_up_competitors, which has no participant FK — so that narrow intent is
    // correct ONLY while factory refuses to delete a participant holding a draw position.
    // Both halves are pinned: if that guard ever relaxes, this fails and the projection
    // needs a competitor cascade.
    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      drawProfiles: [{ drawSize: 8, eventName: 'Singles' }],
      participantsProfile: { participantsCount: 12 },
      completeAllMatchUps: true,
    });
    await tournamentEngineAsync.setState(tournamentRecord);
    const seeded = (await tournamentEngineAsync.getTournament()).tournamentRecord;
    const entered = new Set(seeded.events[0].entries.map((e: any) => e.participantId));
    const competing = seeded.participants.find(
      (p: any) => p.participantType === 'INDIVIDUAL' && entered.has(p.participantId),
    );
    const spare = seeded.participants.find(
      (p: any) => p.participantType === 'INDIVIDUAL' && !entered.has(p.participantId),
    );
    expect(competing).toBeDefined();
    expect(spare).toBeDefined();

    // half 1 — the dangerous case is refused at the source
    const refused: any = await tournamentEngineAsync.deleteParticipants({
      participantIds: [competing.participantId],
    });
    expect(refused?.success).not.toBe(true);
    expect(refused?.error?.code).toEqual('ERR_EXISTING_PARTICIPANT_DRAW_POSITION_ASSIGNMENT');

    // half 2 — a non-competing participant deletes cleanly and converges to cast()
    const tournamentId = seeded.tournamentId;
    const records = { [tournamentId]: seeded };
    const initialDeltas = await buildProjectionDeltas({
      intents: buildRebuildIntents(seeded),
      tournamentRecords: records,
      flattenDraw: await flattenDrawOf(seeded),
    });
    const removedOk: any = await tournamentEngineAsync.deleteParticipants({ participantIds: [spare.participantId] });
    expect(removedOk?.success).toEqual(true);

    const finalRecord = (await tournamentEngineAsync.getTournament()).tournamentRecord;
    records[tournamentId] = finalRecord;
    const incrementalDeltas = await buildProjectionDeltas({
      intents: [{ kind: 'deleteParticipants', tournamentId, participantIds: [spare.participantId] }],
      tournamentRecords: records,
      flattenDraw: await flattenDrawOf(finalRecord),
    });

    const tables = applyDeltas([...initialDeltas, ...incrementalDeltas]);
    const castRows: any = readModel.cast({ tournamentRecord: finalRecord }).rows;
    const castEntries = [...(castRows.entries ?? [])].sort((a: any, b: any) =>
      keyString('entries', a).localeCompare(keyString('entries', b)),
    );
    expect(snapshot(tables, 'entries')).toEqual(castEntries);
    // the deleted participant never competed, so no competitor row should reference them
    expect(
      snapshot(tables, 'match_up_competitors').some((r: any) => r.individual_participant_id === spare.participantId),
    ).toBe(false);
  });

  it('PUBLISH_ORDER_OF_PLAY then UNPUBLISH: the orderOfPlay intent tracks cast() both ways', async () => {
    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      drawProfiles: [{ drawSize: 8, eventName: 'Singles' }],
    });
    await tournamentEngineAsync.setState(tournamentRecord);
    const tournamentId = tournamentRecord.tournamentId;
    const records = { [tournamentId]: tournamentRecord };
    const initialDeltas = await buildProjectionDeltas({
      intents: buildRebuildIntents(tournamentRecord),
      tournamentRecords: records,
      flattenDraw: await flattenDrawOf(tournamentRecord),
    });

    const published: any = await tournamentEngineAsync.publishOrderOfPlay();
    expect(published?.success).toEqual(true);
    const afterPublish = (await tournamentEngineAsync.getTournament()).tournamentRecord;
    records[tournamentId] = afterPublish;
    const publishDeltas = await buildProjectionDeltas({
      intents: [{ kind: 'orderOfPlay', tournamentId }],
      tournamentRecords: records,
      flattenDraw: await flattenDrawOf(afterPublish),
    });

    let tables = applyDeltas([...initialDeltas, ...publishDeltas]);
    const castPublished: any = readModel.cast({ tournamentRecord: afterPublish }).rows;
    expect(snapshot(tables, 'order_of_play')).toEqual(castPublished.order_of_play ?? []);
    expect(snapshot(tables, 'order_of_play').length).toBe(1);

    // …and back off again — an unpublish that left the row behind would keep a schedule
    // visible after it was withdrawn, which is the direction that actually leaks.
    const unpublished: any = await tournamentEngineAsync.unPublishOrderOfPlay();
    expect(unpublished?.success).toEqual(true);
    const afterUnpublish = (await tournamentEngineAsync.getTournament()).tournamentRecord;
    records[tournamentId] = afterUnpublish;
    const unpublishDeltas = await buildProjectionDeltas({
      intents: [{ kind: 'orderOfPlay', tournamentId }],
      tournamentRecords: records,
      flattenDraw: await flattenDrawOf(afterUnpublish),
    });

    tables = applyDeltas([...initialDeltas, ...publishDeltas, ...unpublishDeltas]);
    const castUnpublished: any = readModel.cast({ tournamentRecord: afterUnpublish }).rows;
    expect(snapshot(tables, 'order_of_play')).toEqual(castUnpublished.order_of_play ?? []);
  });

  it('tournaments.published tracks the publish AGGREGATE through touchTournament, both ways', async () => {
    // There is no unPublishTournament method: tournaments.published is an AGGREGATE —
    // published when the order of play OR the participant list is — and UNPUBLISH_TOURNAMENT
    // is the notice factory emits when the last of those is withdrawn. It maps to
    // touchTournament, which re-projects only the tournaments row. That is correct rather
    // than narrow, because event/matchUp visibility is driven by EVENT publish state, not
    // by this aggregate. Pinned in both directions so a future cascade is a deliberate act.
    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      drawProfiles: [{ drawSize: 8, eventName: 'Singles' }],
    });
    await tournamentEngineAsync.setState(tournamentRecord);
    const tournamentId = tournamentRecord.tournamentId;
    const records = { [tournamentId]: tournamentRecord };
    const initialDeltas = await buildProjectionDeltas({
      intents: buildRebuildIntents(tournamentRecord),
      tournamentRecords: records,
      flattenDraw: await flattenDrawOf(tournamentRecord),
    });
    expect(snapshot(applyDeltas(initialDeltas), 'tournaments')[0].published).toBeFalsy();

    expect((await tournamentEngineAsync.publishParticipants({}))?.success).toEqual(true);
    const afterPublish = (await tournamentEngineAsync.getTournament()).tournamentRecord;
    records[tournamentId] = afterPublish;
    const publishDeltas = await buildProjectionDeltas({
      intents: [
        { kind: 'participantPublish', tournamentId },
        { kind: 'touchTournament', tournamentId },
      ],
      tournamentRecords: records,
      flattenDraw: await flattenDrawOf(afterPublish),
    });

    let tables = applyDeltas([...initialDeltas, ...publishDeltas]);
    const castPublished: any = readModel.cast({ tournamentRecord: afterPublish }).rows;
    expect(snapshot(tables, 'tournaments')).toEqual(castPublished.tournaments);
    expect(snapshot(tables, 'tournaments')[0].published).toBe(true);
    expect(snapshot(tables, 'participant_publish').length).toBe(1);

    // withdraw it — the aggregate must fall back to false, and the publish-state row must go
    expect((await tournamentEngineAsync.unPublishParticipants({}))?.success).toEqual(true);
    const afterUnpublish = (await tournamentEngineAsync.getTournament()).tournamentRecord;
    records[tournamentId] = afterUnpublish;
    const unpublishDeltas = await buildProjectionDeltas({
      intents: [
        { kind: 'participantPublish', tournamentId },
        { kind: 'touchTournament', tournamentId },
      ],
      tournamentRecords: records,
      flattenDraw: await flattenDrawOf(afterUnpublish),
    });

    tables = applyDeltas([...initialDeltas, ...publishDeltas, ...unpublishDeltas]);
    const castUnpublished: any = readModel.cast({ tournamentRecord: afterUnpublish }).rows;
    expect(snapshot(tables, 'tournaments')).toEqual(castUnpublished.tournaments);
    expect(snapshot(tables, 'tournaments')[0].published).toBeFalsy();
    expect(snapshot(tables, 'participant_publish')).toEqual(castUnpublished.participant_publish ?? []);
  });

  it('NATIVE scheduling profile: the schedulingProfile intent matches cast() (LEGACY path already covered)', async () => {
    // The existing scheduling test drives the LEGACY extension path. The resolver handles
    // both, and NATIVE is the default writeMode since 2026-07-03, so the first-class
    // `scheduling.profile` shape is the one prod actually produces.
    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      drawProfiles: [{ drawSize: 8, eventName: 'Singles' }],
      venueProfiles: [{ venueId: 'v1', venueName: 'Club', courtsCount: 2, idPrefix: 'v1c' }],
    });
    const tournamentId = tournamentRecord.tournamentId;
    const draw = tournamentRecord.events[0].drawDefinitions[0];
    const profile = [
      {
        scheduleDate: '2025-01-05',
        venues: [
          {
            venueId: 'v1',
            rounds: [
              {
                eventId: tournamentRecord.events[0].eventId,
                drawId: draw.drawId,
                structureId: draw.structures[0].structureId,
                roundNumber: 1,
              },
            ],
          },
        ],
      },
    ];
    // NATIVE: first-class, no extension.
    (tournamentRecord as any).scheduling = { profile };

    const records = { [tournamentId]: tournamentRecord };
    const incrementalDeltas = await buildProjectionDeltas({
      intents: [{ kind: 'schedulingProfile', tournamentId, schedulingProfile: profile }],
      tournamentRecords: records,
      flattenDraw: await flattenDrawOf(tournamentRecord),
    });

    const tables = applyDeltas(incrementalDeltas);
    const castRows: any = readModel.cast({ tournamentRecord }).rows;
    const castSort = [...(castRows.scheduling_profile ?? [])].sort((a: any, b: any) =>
      keyString('scheduling_profile', a).localeCompare(keyString('scheduling_profile', b)),
    );
    expect(castSort.length).toBeGreaterThan(0); // the NATIVE shape must actually resolve
    expect(snapshot(tables, 'scheduling_profile')).toEqual(castSort);
  });

  it('MODIFY_DRAW_ENTRIES: the entries grain is EVENT-scoped — a draw-entry change projects nothing', async () => {
    // MODIFY_DRAW_ENTRIES is a subscribed topic, which invites the assumption that draw
    // entry status is queryable. It is not: entryRows walks event.entries only, so
    // query_entries has no draw_id column and a pure draw-scope change moves no row.
    // Pinned so nobody builds a query on drawDefinition entry status that can never work.
    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      drawProfiles: [{ drawSize: 8, eventName: 'Singles' }],
    });
    const tournamentId = tournamentRecord.tournamentId;
    const records = { [tournamentId]: tournamentRecord };
    const initialDeltas = await buildProjectionDeltas({
      intents: buildRebuildIntents(tournamentRecord),
      tournamentRecords: records,
      flattenDraw: await flattenDrawOf(tournamentRecord),
    });
    const before = snapshot(applyDeltas(initialDeltas), 'entries');
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((r: any) => !('draw_id' in r))).toBe(true);

    // change a DRAW entry's status only; the event entry is untouched
    const drawDefinition = tournamentRecord.events[0].drawDefinitions[0];
    const drawEntry = (drawDefinition.entries ?? [])[0];
    expect(drawEntry).toBeDefined();
    drawEntry.entryStatus = 'ALTERNATE';

    const incrementalDeltas = await buildProjectionDeltas({
      intents: [{ kind: 'entries', tournamentId }],
      tournamentRecords: records,
      flattenDraw: await flattenDrawOf(tournamentRecord),
    });

    // the intent must genuinely RUN — otherwise "unchanged" would hold vacuously for a
    // dead intent just as well as for a correctly-identical re-projection
    expect(incrementalDeltas.length).toBeGreaterThan(0);

    const tables = applyDeltas([...initialDeltas, ...incrementalDeltas]);
    const castRows: any = readModel.cast({ tournamentRecord }).rows;
    const castEntries = [...(castRows.entries ?? [])].sort((a: any, b: any) =>
      keyString('entries', a).localeCompare(keyString('entries', b)),
    );
    expect(snapshot(tables, 'entries')).toEqual(castEntries);
    expect(snapshot(tables, 'entries')).toEqual(before); // genuinely unchanged
  });

  it('composite [Unpublish Tournament]: the real TMX three-notice flow darkens every projected surface', async () => {
    // The user-facing operation. TMX's [Unpublish Tournament] button
    // (publishingTab/tournamentControls.ts) has NO single engine method behind it — it
    // composes UNPUBLISH_PARTICIPANTS + UNPUBLISH_ORDER_OF_PLAY + one UNPUBLISH_EVENT per
    // published event into a single mutationRequest. Factory then fires UNPUBLISH_TOURNAMENT
    // on its own, from checkAndNotifyUnpublishTournament, once the LAST publication is gone.
    //
    // Each leg has a different carrier, which is the point of testing the composite rather
    // than the legs: participants → participantPublish, OoP → orderOfPlay, event → events +
    // republishEvent (the flatten that moves match_ups.published), tournament →
    // touchTournament. A single missing leg leaves content visible after it was withdrawn.
    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      drawProfiles: [{ drawSize: 8, eventName: 'Singles' }],
      completeAllMatchUps: true,
    });
    await tournamentEngineAsync.setState(tournamentRecord);
    const tournamentId = tournamentRecord.tournamentId;
    const eventId = tournamentRecord.events[0].eventId;

    // ── publish everything ────────────────────────────────────────────────────
    expect((await tournamentEngineAsync.publishEvent({ eventId }))?.success).toEqual(true);
    expect((await tournamentEngineAsync.publishOrderOfPlay())?.success).toEqual(true);
    expect((await tournamentEngineAsync.publishParticipants({}))?.success).toEqual(true);

    const published = (await tournamentEngineAsync.getTournament()).tournamentRecord;
    const records = { [tournamentId]: published };
    const publishedDeltas = await buildProjectionDeltas({
      intents: buildRebuildIntents(published),
      tournamentRecords: records,
      flattenDraw: await flattenDrawOf(published),
    });
    const publishedTables = applyDeltas(publishedDeltas);
    // the starting state must genuinely be "visible", or the darkening proves nothing
    expect(snapshot(publishedTables, 'tournaments')[0].published).toBe(true);
    expect(snapshot(publishedTables, 'events')[0].published).toBe(true);
    // guard the vacuity trap: .every() and .some() both give the wanted answer on an
    // EMPTY array, so a flatten that produced no rows at all would pass silently.
    expect(snapshot(publishedTables, 'match_ups').length).toBeGreaterThan(0);
    expect(snapshot(publishedTables, 'match_ups').every((r: any) => r.published)).toBe(true);
    expect(snapshot(publishedTables, 'order_of_play').length).toBe(1);
    expect(snapshot(publishedTables, 'participant_publish').length).toBe(1);

    // ── the composite unpublish, in TMX's order, capturing what factory dispatches ──
    const firedTopics: string[] = [];
    const capture: Record<string, any> = {};
    for (const topic of Object.values(topicConstants) as string[]) {
      capture[topic] = () => firedTopics.push(topic);
    }
    globalState.setSubscriptions({ subscriptions: capture });
    try {
      expect((await tournamentEngineAsync.unPublishParticipants({}))?.success).toEqual(true);
      expect((await tournamentEngineAsync.unPublishOrderOfPlay())?.success).toEqual(true);
      expect((await tournamentEngineAsync.unPublishEvent({ eventId }))?.success).toEqual(true);
    } finally {
      globalState.setSubscriptions({ subscriptions: {} });
    }

    // factory's derived "fully dark" signal must have fired — this is the leg that has no
    // engine method and so is easiest to assume away.
    expect(firedTopics).toContain(topicConstants.UNPUBLISH_TOURNAMENT);

    const dark = (await tournamentEngineAsync.getTournament()).tournamentRecord;
    records[tournamentId] = dark;
    const unpublishDeltas = await buildProjectionDeltas({
      intents: [
        { kind: 'participantPublish', tournamentId },
        { kind: 'orderOfPlay', tournamentId },
        { kind: 'events', tournamentId },
        { kind: 'republishEvent', tournamentId, eventId },
        { kind: 'touchTournament', tournamentId },
      ],
      tournamentRecords: records,
      flattenDraw: await flattenDrawOf(dark),
    });

    const tables = applyDeltas([...publishedDeltas, ...unpublishDeltas]);
    const castDark: any = readModel.cast({ tournamentRecord: dark }).rows;

    // every projected visibility surface converges to the rebuild oracle
    expect(snapshot(tables, 'tournaments')).toEqual(castDark.tournaments);
    expect(snapshot(tables, 'events')).toEqual(castDark.events);
    expect(snapshot(tables, 'order_of_play')).toEqual(castDark.order_of_play ?? []);
    expect(snapshot(tables, 'participant_publish')).toEqual(castDark.participant_publish ?? []);

    // …and explicitly: nothing is left visible. This is the direction that leaks.
    expect(snapshot(tables, 'tournaments')[0].published).toBeFalsy();
    expect(snapshot(tables, 'match_ups').length).toBeGreaterThan(0); // not vacuously dark
    expect(snapshot(tables, 'match_ups').some((r: any) => r.published)).toBe(false);
    expect(snapshot(tables, 'order_of_play')).toEqual([]);
    expect(snapshot(tables, 'participant_publish')).toEqual([]);

    // Was a pinned KNOWN BUG here: events.published stayed TRUE after unpublish, because
    // both cast() and this producer tested `!!getEventPublishStatus({ event })` and
    // unPublishEvent retains the PUBLIC envelope with undefined-valued keys. Fixed in
    // factory `isEventPublished`, which resolves through the same cascade as the matchUps
    // and is now shared by both paths.
    expect(snapshot(tables, 'events')[0].published).toBe(false);
    expect(snapshot(tables, 'events')).toEqual(castDark.events); // producer ≡ cast()
  });

  itWithBracketTopology(
    'progression edges are DERIVED: a record with none stored still projects them, incremental ≡ cast',
    async () => {
      // Every other fixture here is freshly generated by mocksEngine, so its edges are
      // already materialised and derived == stored — which means none of them can catch a
      // path that only reads stored values. Verified against a real prod tournament first:
      // 22 matchUps, 20 winner edges, 0 loser edges STORED, despite a live consolation feed.
      const { tournamentRecord } = mocksEngine.generateTournamentRecord({
        drawProfiles: [{ drawSize: 16, drawType: 'FIRST_ROUND_LOSER_CONSOLATION', eventName: 'Singles' }],
      });
      const tournamentId = tournamentRecord.tournamentId;

      // strip the materialised edges — imitate an older record
      for (const event of tournamentRecord.events ?? []) {
        for (const drawDefinition of event.drawDefinitions ?? []) {
          for (const structure of drawDefinition.structures ?? []) {
            for (const matchUp of structure.matchUps ?? []) {
              delete matchUp.loserMatchUpId;
              delete matchUp.winnerMatchUpId;
            }
          }
        }
      }

      const deltas = await buildProjectionDeltas({
        intents: buildRebuildIntents(tournamentRecord),
        tournamentRecords: { [tournamentId]: tournamentRecord },
        flattenDraw: await flattenDrawOf(tournamentRecord),
      });
      const rows = snapshot(applyDeltas(deltas), 'match_ups');

      // the producer recovered them
      expect(rows.filter((r: any) => r.winner_match_up_id).length).toBeGreaterThan(0);
      expect(rows.filter((r: any) => r.loser_match_up_id).length).toBeGreaterThan(0);

      // …and agrees with cast(), which derives them through the same helper
      const castRows: any = readModel.cast({ tournamentRecord }).rows;
      const sortByKey = (list: any[]) =>
        [...list].sort((a, b) => keyString('match_ups', a).localeCompare(keyString('match_ups', b)));
      expect(sortByKey(rows)).toEqual(sortByKey(castRows.match_ups ?? []));

      // no edge may point at a matchUp that does not exist
      const live = new Set(rows.map((r: any) => r.match_up_id));
      for (const row of rows) {
        if (row.winner_match_up_id) expect(live.has(row.winner_match_up_id)).toBe(true);
        if (row.loser_match_up_id) expect(live.has(row.loser_match_up_id)).toBe(true);
      }
    },
  );

  it('publishEventSeeding → incremental events.published matches cast() (seeding topic projects)', async () => {
    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      drawProfiles: [{ drawSize: 8, seedsCount: 4, eventName: 'Singles' }],
    });
    const tournamentId = tournamentRecord.tournamentId;
    const eventId = tournamentRecord.events[0].eventId;
    const noFlatten = async () => [];

    // baseline: an unpublished event projects published:false (incremental == cast).
    const castEvents = (rec: any): any[] => (readModel.cast({ tournamentRecord: rec }).rows as any).events;
    expect(castEvents(tournamentRecord)[0].published).toBe(false);

    // publish seeding via the engine (writes the real PUBLISH.STATUS timeItem).
    await tournamentEngineAsync.setState(tournamentRecord);
    const pub: any = await tournamentEngineAsync.publishEventSeeding({ eventId });
    expect(pub.success).toBe(true);
    const mutated: any = (await tournamentEngineAsync.getState()).tournamentRecords[tournamentId];

    // cast() (the oracle) now reports published:true.
    expect(castEvents(mutated)[0].published).toBe(true);

    // the incremental events intent (fired by the newly-subscribed PUBLISH_EVENT_SEEDING) must agree.
    const deltas = await buildProjectionDeltas({
      intents: [{ kind: 'events', tournamentId }],
      tournamentRecords: { [tournamentId]: mutated },
      flattenDraw: noFlatten,
    });
    const eventRow = deltas.find((d) => d.table === 'events' && d.row?.event_id === eventId);
    expect(eventRow?.row?.published).toBe(true);
  });

  // A per-structure roundLimit hides rounds beyond the limit (getEventData drops them).
  // The incremental/rebuild producer threads matchUp.roundNumber into resolveMatchUpPublishState
  // exactly as cast() does, so the two must agree — and rounds beyond the limit must be
  // published:false, not exposed.
  it('roundLimit publish: rebuild match_ups.published gates identically to cast()', async () => {
    const {
      tournamentRecord,
      eventIds: [eventId],
      drawIds: [drawId],
    } = mocksEngine.generateTournamentRecord({
      drawProfiles: [{ eventType: 'SINGLES', drawType: 'AD_HOC', automated: true, roundsCount: 3, drawSize: 20 }],
    });
    await tournamentEngineAsync.setState(tournamentRecord);
    const structureId = (await tournamentEngineAsync.getEvent({ drawId })).drawDefinition.structures[0].structureId;
    await tournamentEngineAsync.publishEvent({
      eventId,
      removePriorValues: true,
      drawDetails: { [drawId]: { structureDetails: { [structureId]: { roundLimit: 1, published: true } } } },
    });
    const mutated: any = (await tournamentEngineAsync.getState()).tournamentRecords[tournamentRecord.tournamentId];

    const flattenDraw = await flattenDrawOf(mutated);
    const rebuiltDeltas = await buildProjectionDeltas({
      intents: buildRebuildIntents(mutated),
      tournamentRecords: { [mutated.tournamentId]: mutated },
      flattenDraw,
    });
    const rebuilt = applyDeltas(rebuiltDeltas);

    const castRows: any = readModel.cast({ tournamentRecord: mutated }).rows;
    const castSnap = [...(castRows.match_ups ?? [])].sort((a: any, b: any) =>
      keyString('match_ups', a).localeCompare(keyString('match_ups', b)),
    );
    expect(snapshot(rebuilt, 'match_ups')).toEqual(castSnap);

    // rounds beyond the limit exist and are published:false in both paths.
    const beyond = castSnap.filter((r: any) => (r.round_number ?? 0) > 1);
    expect(beyond.length).toBeGreaterThan(0);
    expect(beyond.every((r: any) => r.published === false)).toBe(true);
  });

  // Round-robin nested group sub-structures: the producer now walks nested
  // structures so every matchUp's structure_id (a GROUP) resolves to a structures
  // row, and rebuild stays byte-identical to cast().
  it('round-robin nested structures: rebuild ≡ cast + no orphaned match_up structure_id', async () => {
    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      drawProfiles: [{ drawSize: 8, drawType: 'ROUND_ROBIN', eventName: 'RR' }],
      completeAllMatchUps: true,
    });
    const tournamentId = tournamentRecord.tournamentId;
    const flattenDraw = await flattenDrawOf(tournamentRecord);
    const rebuiltDeltas = await buildProjectionDeltas({
      intents: buildRebuildIntents(tournamentRecord),
      tournamentRecords: { [tournamentId]: tournamentRecord },
      flattenDraw,
    });
    const rebuilt = applyDeltas(rebuiltDeltas);
    const castRows: any = readModel.cast({ tournamentRecord }).rows;
    const castSort = (table: string) =>
      [...(castRows[table] ?? [])].sort((a: any, b: any) => keyString(table, a).localeCompare(keyString(table, b)));

    for (const table of ['structures', 'match_ups']) {
      expect(snapshot(rebuilt, table)).toEqual(castSort(table));
    }

    const structureIds = new Set(snapshot(rebuilt, 'structures').map((s: any) => s.structure_id));
    const muStructureIds = [...new Set(snapshot(rebuilt, 'match_ups').map((s: any) => s.structure_id))];
    expect(muStructureIds.length).toBeGreaterThan(0);
    expect(muStructureIds.every((id) => structureIds.has(id))).toBe(true); // no orphaned join

    const container = snapshot(rebuilt, 'structures').find((s: any) => s.structure_type === 'CONTAINER');
    expect(container).toBeDefined();
    const groups = snapshot(rebuilt, 'structures').filter((s: any) => s.parent_structure_id === container.structure_id);
    expect(groups.length).toBeGreaterThanOrEqual(2);
  });

  // LEGACY / imported records store the scheduling plan in the `schedulingProfile`
  // EXTENSION, not first-class `scheduling.profile`. rebuild used to read NATIVE only,
  // so it emitted zero rows AND the delete-by-tournament WIPED the table cast() had
  // populated. With the shared resolver both paths now agree.
  it('LEGACY extension-backed scheduling profile: rebuild ≡ cast (rebuild no longer empties the table)', async () => {
    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      drawProfiles: [{ drawSize: 8, eventName: 'Singles' }],
      venueProfiles: [{ venueId: 'v1', venueName: 'Club', courtsCount: 2, idPrefix: 'v1c' }],
    });
    const tournamentId = tournamentRecord.tournamentId;
    const draw = tournamentRecord.events[0].drawDefinitions[0];
    const profile = [
      {
        scheduleDate: '2025-01-05',
        venues: [
          {
            venueId: 'v1',
            rounds: [
              {
                eventId: tournamentRecord.events[0].eventId,
                drawId: draw.drawId,
                structureId: draw.structures[0].structureId,
                roundNumber: 1,
              },
            ],
          },
        ],
      },
    ];
    // LEGACY: the plan lives ONLY in the extension; there is no scheduling.profile.
    (tournamentRecord as any).extensions = [{ name: 'schedulingProfile', value: profile }];

    const flattenDraw = await flattenDrawOf(tournamentRecord);
    const rebuiltDeltas = await buildProjectionDeltas({
      intents: buildRebuildIntents(tournamentRecord),
      tournamentRecords: { [tournamentId]: tournamentRecord },
      flattenDraw,
    });
    const rebuilt = applyDeltas(rebuiltDeltas);
    const castRows: any = readModel.cast({ tournamentRecord }).rows;
    const castSort = [...(castRows.scheduling_profile ?? [])].sort((a: any, b: any) =>
      keyString('scheduling_profile', a).localeCompare(keyString('scheduling_profile', b)),
    );

    expect(snapshot(rebuilt, 'scheduling_profile')).toEqual(castSort);
    expect(castSort.length).toBeGreaterThan(0); // the extension-backed plan projects
    expect(snapshot(rebuilt, 'scheduling_profile').length).toBeGreaterThan(0); // rebuild no longer empties it
  });
});
