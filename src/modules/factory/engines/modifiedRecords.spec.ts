import { asyncEngine, globalState, governors } from 'tods-competition-factory';

import asyncGlobalState from './asyncGlobalState';

// The factory stamps only the records a call modified (competition-factory, building-a-tournament.md § 1.1): this
// provider records the tournament each notice names, and hands the set to the factory through the optional
// cycleModifiedTournamentIds hook. A factory without the hook stamps every loaded record, as before.

const supportsModifiedRecords = typeof (globalState as any).cycleModifiedTournamentIds === 'function';

describe('the CFS state provider records the tournaments a call modified', () => {
  beforeAll(() => {
    globalState.setStateProvider(asyncGlobalState);
  });

  it.runIf(supportsModifiedRecords)(
    'a notice marks modified the tournament it names, and a notice naming none every record',
    async () => {
      await asyncGlobalState.runWithInstanceState(async () => {
        asyncGlobalState.cycleModifiedTournamentIds();
        asyncGlobalState.addNotice({ topic: 'modifyEvent', payload: { tournamentId: 'T1' }, key: undefined });
        expect([...asyncGlobalState.cycleModifiedTournamentIds()]).toEqual(['T1']);

        asyncGlobalState.addNotice({ topic: 'addVenue', payload: { venue: {} }, key: undefined });
        expect([...asyncGlobalState.cycleModifiedTournamentIds()]).toEqual(['*']);
        // read once: the set is cleared as it is read
        expect([...asyncGlobalState.cycleModifiedTournamentIds()]).toEqual([]);

        // a notice that only reports modifies nothing
        asyncGlobalState.addNotice({ topic: 'dataIssue', payload: { tournamentId: 'T1' }, key: undefined });
        expect([...asyncGlobalState.cycleModifiedTournamentIds()]).toEqual([]);
      });
    },
  );

  it('markModified marks a write that announces nothing', async () => {
    await asyncGlobalState.runWithInstanceState(async () => {
      asyncGlobalState.cycleMutationStatus();
      asyncGlobalState.markModified('T2');
      expect(asyncGlobalState.cycleMutationStatus()).toEqual(true);
      expect([...asyncGlobalState.cycleModifiedTournamentIds()]).toEqual(['T2']);
    });
  });

  it('a working copy (notifications disabled) marks nothing', async () => {
    await asyncGlobalState.runWithInstanceState(async () => {
      asyncGlobalState.cycleMutationStatus();
      asyncGlobalState.disableNotifications();
      asyncGlobalState.addNotice({ topic: 'modifyEvent', payload: { tournamentId: 'T1' }, key: undefined });
      asyncGlobalState.enableNotifications();
      expect(asyncGlobalState.cycleMutationStatus()).toEqual(false);
      expect([...asyncGlobalState.cycleModifiedTournamentIds()]).toEqual([]);
    });
  });

  it.runIf(supportsModifiedRecords)('only the record a call wrote takes the factory stamp', async () => {
    await asyncGlobalState.runWithInstanceState(async () => {
      const engine: any = asyncEngine();
      engine.importMethods(governors, true, 1);
      await engine.setState([
        { tournamentId: 'T1', tournamentName: 'one' },
        { tournamentId: 'T2', tournamentName: 'two' },
      ]);
      await engine.setTournamentId('T1');
      const result: any = await engine.executionQueue([{ method: 'addEvent', params: { event: { eventName: 'E' } } }]);
      expect(result.success).toEqual(true);
      const stampOf = async (tournamentId: string) =>
        (await engine.getTournament({ tournamentId })).tournamentRecord.factory?.timeStamp;
      expect(await stampOf('T1')).toBeDefined();
      expect(await stampOf('T2')).toBeUndefined();
    });
  });
});
