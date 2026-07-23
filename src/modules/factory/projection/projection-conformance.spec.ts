import { mocksEngine, tournamentEngineAsync } from 'tods-competition-factory';

import { buildProjectionDeltas } from './buildProjectionDeltas';
import { buildRebuildIntents } from './rebuild';
import { ProjectionIntent } from './projectionTypes';
import { ProjectionDelta } from 'src/storage/interfaces/projection-outbox-storage.interface';

// ── In-memory delta reducer — mirrors the courthive-query consumer's apply
// semantics (upsert-by-PK with partial merge, update-by-key merge, delete-by-key)
// so we can compare the NET read-table state of two producer paths without a DB.
const PK: Record<string, string[]> = {
  tournaments: ['tournament_id'],
  match_ups: ['match_up_id'],
  match_up_competitors: ['match_up_id', 'side_number', 'competitor_index'],
  entries: ['tournament_id', 'event_id', 'participant_id'],
  venues: ['venue_id'],
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
    const rebuildDeltas = await buildProjectionDeltas({ intents: buildRebuildIntents(tournamentRecord), tournamentRecords: records, flattenDraw });

    // INCREMENTAL path: the intents the producers accumulate over the tournament
    // lifecycle — draw flatten + a slim result update per completed matchUp +
    // participants/touch/venue/claim. Must converge to the same rows.
    const flatMatchUps = await flattenDraw(tournamentId, tournamentRecord.events[0].drawDefinitions[0].drawId);
    const incrementalIntents: ProjectionIntent[] = [
      { kind: 'touchTournament', tournamentId },
      { kind: 'participants', tournamentId },
      ...tournamentRecord.events.flatMap((e: any) =>
        (e.drawDefinitions ?? []).map((d: any) => ({ kind: 'flattenDraw', tournamentId, drawId: d.drawId }) as ProjectionIntent),
      ),
      ...flatMatchUps
        .filter((m: any) => m.winningSide || m.matchUpStatus)
        .map((m: any) => ({ kind: 'matchUpResult', tournamentId, matchUp: m }) as ProjectionIntent),
      { kind: 'claimPerson', tournamentId, participantId: claimed.participantId, personId: 'canon-conf' },
    ];
    const incrementalDeltas = await buildProjectionDeltas({ intents: incrementalIntents, tournamentRecords: records, flattenDraw });

    const rebuilt = applyDeltas(rebuildDeltas);
    const incremental = applyDeltas(incrementalDeltas);

    for (const table of ['tournaments', 'match_ups', 'match_up_competitors', 'entries']) {
      expect(snapshot(incremental, table)).toEqual(snapshot(rebuilt, table));
    }
    // sanity: the tournament actually produced rows
    expect(snapshot(rebuilt, 'match_ups').length).toBeGreaterThan(0);
    expect(snapshot(rebuilt, 'match_up_competitors').some((r) => r.person_id === 'canon-conf')).toBe(true);
  });
});
