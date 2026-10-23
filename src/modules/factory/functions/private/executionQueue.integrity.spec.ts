import { drawIntegrityScanStats, resetDrawIntegrityMemory } from '../../helpers/executionQueueIntegrity';
import { mocksEngine, queryGovernor, tournamentEngine, tools } from 'tods-competition-factory';
import { isTournamentLocked } from 'src/services/tournamentMutex';
import { executionQueue } from './executionQueue';
import { Logger } from '@nestjs/common';

import type { TournamentStorageService } from 'src/storage/tournament-storage.service';

/**
 * The executionQueue path's draw-integrity scan, end to end through the real factory engine and its real notices.
 *
 * Storage mirrors the real one where it matters here: a fetch PARSES the stored row, so every request gets its own
 * objects (ITournamentStorage.fetchTournamentRecords), and a save SERIALISES what it is given. That is the property
 * the scan relies on to read the mutation's own drawDefinitions after the lock is released without copying them.
 */
function storageFor(record: any) {
  let row = JSON.stringify(record);
  const tournamentId = record.tournamentId;
  const events: string[] = [];
  const storage = {
    events,
    fetchTournamentRecords: vi.fn(async () => ({
      success: true,
      tournamentRecords: { [tournamentId]: JSON.parse(row) },
    })),
    saveTournamentRecords: vi.fn(async ({ tournamentRecords }: any) => {
      events.push(`save:locked=${isTournamentLocked(tournamentId)}`);
      row = JSON.stringify(tournamentRecords[tournamentId]);
      return { success: true };
    }),
    stored: () => JSON.parse(row),
  };
  return storage;
}

const run = (storage: ReturnType<typeof storageFor>, tournamentId: string, methods: any[], services?: any) =>
  executionQueue({ tournamentIds: [tournamentId], methods }, services, storage as unknown as TournamentStorageService);

const flushImmediates = () => new Promise((resolve) => setImmediate(() => setImmediate(resolve)));

const integrityLines = (spy: any) =>
  spy.mock.calls
    .filter(([, context]) => context === 'DrawIntegrity')
    .map(([line]) => JSON.parse(line))
    .filter((line) => line.event === 'draw-integrity');

function generated(drawType = 'FIRST_MATCH_LOSER_CONSOLATION') {
  const { tournamentRecord } = mocksEngine.generateTournamentRecord({
    drawProfiles: [{ drawSize: 16, drawType }],
    nonRandom: 1,
  });
  // makeDeepCopy, not structuredClone: a clone keeps objects the generator SHARES between links shared, so breaking
  // one link would break its siblings too. A deep copy shares nothing — as the row storage parses for each fetch.
  return tools.makeDeepCopy(tournamentRecord, false, true);
}

/** Completed-score methods for round-1 matchUps of the draw's FIRST structure that are ready to score. */
function scoreMethods(record: any, count = 1) {
  tournamentEngine.setState(structuredClone(record));
  const { drawId, structures } = record.events[0].drawDefinitions[0];
  const { matchUps = [] } = tournamentEngine.allTournamentMatchUps({ matchUpFilters: { drawIds: [drawId] } });
  const first = structures[0].structureId;
  const ready = matchUps.filter((m: any) => m.structureId === first && m.roundNumber === 1 && m.readyToScore);
  const { outcome } = mocksEngine.generateOutcomeFromScoreString({ scoreString: '6-1 6-1', winningSide: 1 });
  return ready.slice(0, count).map((matchUp: any) => ({
    method: 'setMatchUpStatus',
    params: { drawId, matchUpId: matchUp.matchUpId, outcome },
  }));
}

describe('executionQueue draw integrity (report only, deferred)', () => {
  const previousMode = process.env.DRAW_INTEGRITY_MODE;
  let warn: any;
  let log: any;

  beforeEach(() => {
    delete process.env.DRAW_INTEGRITY_MODE;
    resetDrawIntegrityMemory();
    warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    log = vi.spyOn(Logger, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => {
    if (previousMode === undefined) delete process.env.DRAW_INTEGRITY_MODE;
    else process.env.DRAW_INTEGRITY_MODE = previousMode;
  });

  it('a clean mutation is scanned — and logs nothing', async () => {
    const record = generated();
    const storage = storageFor(record);
    const scan = vi.spyOn(queryGovernor, 'getDrawInconsistencies');

    const result: any = await run(storage, record.tournamentId, scoreMethods(record));
    expect(result).toMatchObject({ success: true });
    await flushImmediates();

    // The positive control: the hook DID run, on the draw the score landed in. Silence is a clean draw, not a no-op.
    expect(scan).toHaveBeenCalledTimes(1);
    expect(scan.mock.calls[0][0]).toMatchObject({ drawId: record.events[0].drawDefinitions[0].drawId });
    expect(integrityLines(warn)).toEqual([]);
    expect(integrityLines(log)).toEqual([]);
  });

  it('a mutation that INTRODUCES an error-severity inconsistency logs it as introduced, naming the method', async () => {
    // addDrawDefinition accepts a draw whose LOSER link has no source round; the wholesale-save gate would see it,
    // and until now nothing on this path did.
    const template = generated();
    const drawDefinition = structuredClone(template.events[0].drawDefinitions[0]);
    const loserLink = drawDefinition.links.find((link: any) => link.linkType === 'LOSER');
    delete loserLink.source.roundNumber;
    const record = structuredClone(template);
    record.events[0].drawDefinitions = [];
    const storage = storageFor(record);

    const result: any = await run(storage, record.tournamentId, [
      { method: 'addDrawDefinition', params: { drawDefinition, eventId: record.events[0].eventId } },
    ]);
    expect(result).toMatchObject({ success: true });
    await flushImmediates();

    const lines = integrityLines(warn);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      event: 'draw-integrity',
      source: 'executionQueue',
      mode: 'report',
      finding: 'introduced',
      tournamentId: record.tournamentId,
      drawId: drawDefinition.drawId,
      methods: ['addDrawDefinition'],
      issueTypes: ['LINK_MISSING_SOURCE_ROUND'],
    });
    expect(lines[0].issues[0]).toMatchObject({
      issueType: 'LINK_MISSING_SOURCE_ROUND',
      severity: 'error',
      structureId: loserLink.source.structureId,
      fingerprint: expect.any(String),
    });
    // Report only: the mutation was saved, broken draw and all.
    expect(storage.stored().events[0].drawDefinitions).toHaveLength(1);
  });

  it('a mutation on an ALREADY-broken draw logs baseline, then pre-existing — never introduced', async () => {
    // A round-1 matchUp whose drawPositions are stored descending: DRAW_POSITIONS_NOT_SORTED, error severity. Not
    // one of the matchUps scored below, so the mutations themselves succeed. (A broken LINK will not do here: the
    // engine refuses to score anywhere in a draw whose links it cannot read.)
    const record = generated();
    const [first, second, third] = scoreMethods(record, 3);
    const scored = new Set([first, second, third].map((method) => method.params.matchUpId));
    const draw = record.events[0].drawDefinitions[0];
    const unsorted = draw.structures[0].matchUps.find(
      (matchUp: any) => matchUp.roundNumber === 1 && !scored.has(matchUp.matchUpId),
    );
    unsorted.drawPositions.reverse();
    const storage = storageFor(record);

    expect(await run(storage, record.tournamentId, [first])).toMatchObject({ success: true });
    await flushImmediates();
    expect(integrityLines(warn)).toEqual([
      expect.objectContaining({ finding: 'baseline', drawId: draw.drawId, issueTypes: ['DRAW_POSITIONS_NOT_SORTED'] }),
    ]);
    warn.mockClear();

    expect(await run(storage, record.tournamentId, [second])).toMatchObject({ success: true });
    expect(await run(storage, record.tournamentId, [third])).toMatchObject({ success: true });
    await flushImmediates();
    expect(integrityLines(warn)).toEqual([]); // nothing introduced
    expect(integrityLines(log)).toEqual([
      expect.objectContaining({
        finding: 'pre-existing',
        drawId: draw.drawId,
        methods: ['setMatchUpStatus'],
        errorCount: 1,
      }),
    ]); // once per draw, not once per mutation
  });

  it('returns the response BEFORE the scan runs, and the scan runs with the lock RELEASED', async () => {
    const record = generated();
    const storage = storageFor(record);
    const tournamentId = record.tournamentId;
    vi.spyOn(queryGovernor, 'getDrawInconsistencies').mockImplementation(() => {
      storage.events.push(`scan:locked=${isTournamentLocked(tournamentId)}`);
      return { success: true, inconsistencies: [] } as any;
    });

    const result: any = await run(storage, tournamentId, scoreMethods(record));
    storage.events.push('response');
    expect(result).toMatchObject({ success: true });
    await flushImmediates();

    // save:locked=true is the control: it shows the probe CAN see a held lock.
    expect(storage.events).toEqual(['save:locked=true', 'response', 'scan:locked=false']);
  });

  it('a later mutation of the same draw cannot change what an earlier scan sees', async () => {
    const record = generated();
    const storage = storageFor(record);
    const scan = vi.spyOn(queryGovernor, 'getDrawInconsistencies');
    const [first, second] = scoreMethods(record, 2);

    await run(storage, record.tournamentId, [first]);
    await run(storage, record.tournamentId, [second]); // before the first scan has run
    await flushImmediates();

    expect(scan).toHaveBeenCalledTimes(2);
    const matchUpIn = (call: number, matchUpId: string) =>
      (scan.mock.calls[call][0] as any).drawDefinition.structures
        .flatMap((structure: any) => structure.matchUps ?? [])
        .find((matchUp: any) => matchUp.matchUpId === matchUpId);
    expect(scan.mock.calls[0][0].drawDefinition).not.toBe(scan.mock.calls[1][0].drawDefinition);
    expect(matchUpIn(0, first.params.matchUpId).winningSide).toBe(1);
    expect(matchUpIn(0, second.params.matchUpId).winningSide).toBeUndefined();
    expect(matchUpIn(1, second.params.matchUpId).winningSide).toBe(1);
  });

  it('finds touched draws from notices: a draw edit is scanned, a tournament edit is not', async () => {
    const record = generated();
    const drawId = record.events[0].drawDefinitions[0].drawId;
    const storage = storageFor(record);
    const scan = vi.spyOn(queryGovernor, 'getDrawInconsistencies');

    await run(storage, record.tournamentId, [{ method: 'setTournamentName', params: { tournamentName: 'Renamed' } }]);
    await flushImmediates();
    expect(scan).not.toHaveBeenCalled();

    await run(storage, record.tournamentId, [{ method: 'modifyDrawName', params: { drawId, drawName: 'Renamed' } }]);
    await flushImmediates();
    expect(scan.mock.calls.map(([params]: any) => params.drawId)).toEqual([drawId]);
  });

  it('finds the draw when matchUps are deleted (DELETED_MATCHUP_IDS names no draw; MODIFY_DRAW_DEFINITION does)', async () => {
    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      drawProfiles: [{ drawSize: 4, drawType: 'AD_HOC', automated: true, roundsCount: 2 }],
      nonRandom: 1,
    });
    const record = structuredClone(tournamentRecord) as any;
    const draw = record.events[0].drawDefinitions[0];
    const matchUpIds = draw.structures[0].matchUps.map((matchUp: any) => matchUp.matchUpId);
    expect(matchUpIds.length).toBeGreaterThan(0);
    const storage = storageFor(record);
    const scan = vi.spyOn(queryGovernor, 'getDrawInconsistencies');

    const result: any = await run(storage, record.tournamentId, [
      { method: 'deleteAdHocMatchUps', params: { drawId: draw.drawId, matchUpIds: matchUpIds.slice(-1) } },
    ]);
    expect(result).toMatchObject({ success: true });
    expect(result.noticeTopics).toContain('deletedMatchUpIds');
    await flushImmediates();
    expect(scan.mock.calls.map(([params]: any) => params.drawId)).toEqual([draw.drawId]);
  });

  it('a deleted draw is not scanned, and is forgotten', async () => {
    const record = generated();
    const draw = record.events[0].drawDefinitions[0];
    const storage = storageFor(record);
    const scan = vi.spyOn(queryGovernor, 'getDrawInconsistencies');

    await run(storage, record.tournamentId, scoreMethods(record));
    await flushImmediates();
    expect(drawIntegrityScanStats().tracked).toBe(1);

    const result: any = await run(storage, record.tournamentId, [
      {
        method: 'deleteDrawDefinitions',
        params: { eventId: record.events[0].eventId, drawIds: [draw.drawId], force: true },
      },
    ]);
    expect(result).toMatchObject({ success: true });
    await flushImmediates();
    expect(scan).toHaveBeenCalledTimes(1);
    expect(drawIntegrityScanStats().tracked).toBe(0);
  });

  it('DRAW_INTEGRITY_MODE=off: nothing is recorded, nothing is scanned', async () => {
    process.env.DRAW_INTEGRITY_MODE = 'off';
    const record = generated();
    const storage = storageFor(record);
    const scan = vi.spyOn(queryGovernor, 'getDrawInconsistencies');

    const result: any = await run(storage, record.tournamentId, scoreMethods(record));
    expect(result).toMatchObject({ success: true });
    await flushImmediates();
    expect(scan).not.toHaveBeenCalled();
    expect(drawIntegrityScanStats()).toMatchObject({ scans: 0, pending: 0 });
  });

  it('DRAW_INTEGRITY_MODE=enforce still only REPORTS on this path: the broken draw is saved', async () => {
    process.env.DRAW_INTEGRITY_MODE = 'enforce';
    const template = generated();
    const drawDefinition = structuredClone(template.events[0].drawDefinitions[0]);
    delete drawDefinition.links.find((link: any) => link.linkType === 'LOSER').source.roundNumber;
    const record = structuredClone(template);
    record.events[0].drawDefinitions = [];
    const storage = storageFor(record);

    const result: any = await run(storage, record.tournamentId, [
      { method: 'addDrawDefinition', params: { drawDefinition, eventId: record.events[0].eventId } },
    ]);
    expect(result).toMatchObject({ success: true });
    await flushImmediates();
    expect(storage.stored().events[0].drawDefinitions).toHaveLength(1);
    expect(integrityLines(warn)).toEqual([expect.objectContaining({ finding: 'introduced', mode: 'report' })]);
  });

  it('a scan that throws never reaches the mutation', async () => {
    const record = generated();
    const storage = storageFor(record);
    vi.spyOn(queryGovernor, 'getDrawInconsistencies').mockImplementation(() => {
      throw new Error('scan exploded');
    });

    const result: any = await run(storage, record.tournamentId, scoreMethods(record));
    expect(result).toMatchObject({ success: true });
    await flushImmediates();
    expect(drawIntegrityScanStats().failures).toBe(1);
    expect(storage.saveTournamentRecords).toHaveBeenCalledTimes(1);
  });

  it('a failed mutation saves nothing and scans nothing', async () => {
    const record = generated();
    const storage = storageFor(record);
    const scan = vi.spyOn(queryGovernor, 'getDrawInconsistencies');

    const result: any = await run(storage, record.tournamentId, [
      { method: 'setMatchUpStatus', params: { drawId: 'no-such-draw', matchUpId: 'no-such-matchUp' } },
    ]);
    expect(result.success).not.toBe(true);
    await flushImmediates();
    expect(storage.saveTournamentRecords).not.toHaveBeenCalled();
    expect(scan).not.toHaveBeenCalled();
  });
});
