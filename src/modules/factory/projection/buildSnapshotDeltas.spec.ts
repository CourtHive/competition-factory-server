import { mocksEngine, tournamentEngineAsync } from 'tods-competition-factory';

import { SNAPSHOT_CASCADE_COVERED_TABLES, SNAPSHOT_OWNED_TABLES, SNAPSHOT_SHARED_TABLES } from './projectionConstants';
import { buildProjectionDeltas } from './buildProjectionDeltas';
import { buildSnapshotDeltas } from './buildSnapshotDeltas';
import { buildRebuildIntents } from './rebuild';

function makeRecord() {
  const { tournamentRecord } = mocksEngine.generateTournamentRecord({
    drawProfiles: [
      { drawSize: 8, seedsCount: 4 },
      { drawSize: 4, eventType: 'DOUBLES', seedsCount: 2 },
    ],
    venueProfiles: [{ courtsCount: 4 }],
    nonRandom: 1,
  });
  return tournamentRecord;
}

const flattenDraw = (tournamentRecord: any) => async (_tid: string, drawId: string) => {
  await tournamentEngineAsync.setState(tournamentRecord);
  const res: any = await tournamentEngineAsync.allDrawMatchUps({ drawId, inContext: true });
  return res?.matchUps ?? [];
};

describe('buildSnapshotDeltas', () => {
  it('brackets the projection with matching begin/end markers', async () => {
    const tournamentRecord = makeRecord();
    const deltas = await buildSnapshotDeltas({ tournamentRecord, snapshotId: 'snap-1', source: 'test' });

    const first = deltas[0];
    const last = deltas[deltas.length - 1];

    expect(first.op).toBe('snapshot_begin');
    expect(last.op).toBe('snapshot_end');
    expect(first.key.snapshotId).toBe('snap-1');
    expect(last.key.snapshotId).toBe('snap-1');
    expect(first.tournamentId).toBe(tournamentRecord.tournamentId);

    // Exactly one of each — a consumer keying off the markers must not see a
    // nested or repeated span.
    expect(deltas.filter((d) => d.op === 'snapshot_begin')).toHaveLength(1);
    expect(deltas.filter((d) => d.op === 'snapshot_end')).toHaveLength(1);
  });

  it('reports a delta count the consumer can use to detect a truncated span', async () => {
    const tournamentRecord = makeRecord();
    const deltas = await buildSnapshotDeltas({ tournamentRecord, snapshotId: 'snap-1', source: 'test' });

    const body = deltas.slice(1, -1);
    expect(deltas[deltas.length - 1].row?.deltaCount).toBe(body.length);
    expect(body.length).toBeGreaterThan(0);
  });

  it('declares the purge scope on the begin marker', async () => {
    const tournamentRecord = makeRecord();
    const [begin] = await buildSnapshotDeltas({ tournamentRecord, snapshotId: 'snap-1', source: 'test' });

    expect(begin.row?.tables).toEqual([...SNAPSHOT_OWNED_TABLES]);
    // The scope must be content-INDEPENDENT: the case a snapshot exists for is a
    // removed entity, which emits no delta. A scope derived from the body would
    // omit exactly the table that needs sweeping.
    for (const table of SNAPSHOT_OWNED_TABLES) {
      expect(begin.row?.tables).toContain(table);
    }
  });

  it('never purges a cross-tournament dimension', async () => {
    const tournamentRecord = makeRecord();
    const [begin] = await buildSnapshotDeltas({ tournamentRecord, snapshotId: 'snap-1', source: 'test' });

    for (const shared of SNAPSHOT_SHARED_TABLES) {
      // `venues` is keyed by venue_id alone and shared between tournaments —
      // purging it by tournament_id would delete another tournament's venues.
      expect(begin.row?.tables).not.toContain(shared);
    }
  });

  it('emits a body identical to the rebuild path (anti-divergence)', async () => {
    const tournamentRecord = makeRecord();

    const snapshot = await buildSnapshotDeltas({ tournamentRecord, snapshotId: 'snap-1', source: 'test' });
    const rebuild = await buildProjectionDeltas({
      intents: buildRebuildIntents(tournamentRecord),
      tournamentRecords: { [tournamentRecord.tournamentId]: tournamentRecord },
      flattenDraw: flattenDraw(tournamentRecord),
    });

    // The snapshot must not become a third, subtly different producer — the
    // markers are the only difference.
    expect(snapshot.slice(1, -1)).toEqual(rebuild);
  });

  it('every purged table carries tournament_id, so a delete-by-tournament is valid', async () => {
    const tournamentRecord = makeRecord();
    const deltas = await buildSnapshotDeltas({ tournamentRecord, snapshotId: 'snap-1', source: 'test' });

    const owned = new Set<string>(SNAPSHOT_OWNED_TABLES);
    const violations = deltas
      .filter((d) => d.op === 'upsert' && owned.has(d.table))
      .filter((d) => d.row?.tournament_id === undefined)
      .map((d) => d.table);

    // If a projected row in an owned table lacks tournament_id, the consumer's
    // `DELETE ... WHERE tournament_id = $1` cannot reach it and the snapshot
    // would leave orphans behind — the bug this whole path exists to fix.
    //
    // This is the assertion that caught match_up_competitors, and it only
    // caught it in CI: locally node_modules/tods-competition-factory is a
    // `link:` symlink to the sibling working copy, where the column IS present.
    // CI installs the pinned published version, which is what production runs.
    expect([...new Set(violations)]).toEqual([]);
  });

  it('keeps cascade-covered tables OUT of the purge scope', async () => {
    const tournamentRecord = makeRecord();
    const [begin] = await buildSnapshotDeltas({ tournamentRecord, snapshotId: 'snap-1', source: 'test' });

    for (const table of SNAPSHOT_CASCADE_COVERED_TABLES) {
      // Listing one here AND in the owned scope would be the bug: the delete
      // would target a column those rows may not carry.
      expect(begin.row?.tables).not.toContain(table);
    }
  });

  it('reports which owned tables this fixture leaves unverified', async () => {
    const tournamentRecord = makeRecord();
    const deltas = await buildSnapshotDeltas({ tournamentRecord, snapshotId: 'snap-1', source: 'test' });

    const exercised = new Set(deltas.filter((d) => d.op === 'upsert').map((d) => d.table));
    const unverified = SNAPSHOT_OWNED_TABLES.filter((t) => !exercised.has(t));

    // The tournament_id assertion above can only check tables this fixture
    // actually produces rows for. Rather than let that gap be silent — which is
    // how match_up_competitors would have slipped through a second time — pin
    // the unexercised set so it is visible, and so ADDING coverage (or adding a
    // table to the scope) forces this list to be revisited.
    expect(unverified).toEqual(['order_of_play', 'scheduling_profile', 'participant_publish']);
  });

  it('confirms the shared table genuinely lacks tournament_id', async () => {
    const tournamentRecord = makeRecord();
    const deltas = await buildSnapshotDeltas({ tournamentRecord, snapshotId: 'snap-1', source: 'test' });

    const venueUpserts = deltas.filter((d) => d.op === 'upsert' && d.table === 'venues');

    // Falsifies the exclusion rather than assuming it: venues is excluded from
    // the purge scope BECAUSE its rows are not tournament-scoped.
    expect(venueUpserts.length).toBeGreaterThan(0);
    for (const delta of venueUpserts) expect(delta.row?.tournament_id).toBeUndefined();
  });

  it('returns nothing for a record with no tournamentId', async () => {
    const deltas = await buildSnapshotDeltas({ tournamentRecord: {}, snapshotId: 'snap-1', source: 'test' });
    expect(deltas).toEqual([]);
  });
});
