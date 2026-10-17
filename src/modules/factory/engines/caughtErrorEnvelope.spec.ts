import { asyncEngine, globalState } from 'tods-competition-factory';

import asyncGlobalState from './asyncGlobalState';

// A method that throws must be a refusal: an error result, rolled back under rollbackOnError. The engine reads the
// error from this provider's handleCaughtError, which used to return nothing, so a throw read as `{}` and the queue
// neither refused nor rolled back (competition-factory#5541). The factory now normalises that itself; this pins the
// provider's own half, which holds on the factory release CFS resolves today.

const methods = {
  rename: ({ tournamentRecord, name }) => {
    tournamentRecord.tournamentName = name;
    return { success: true };
  },
  syncBoom: ({ tournamentRecord }) => {
    tournamentRecord.tournamentName = 'thrown';
    throw new Error('syncBoom');
  },
};

describe('a thrown method is a refusal under the CFS state provider', () => {
  beforeAll(() => {
    globalState.setStateProvider(asyncGlobalState);
  });

  it('handleCaughtError returns the error envelope', () => {
    const result: any = asyncGlobalState.handleCaughtError({
      engineName: 'engine',
      methodName: 'syncBoom',
      params: {},
      err: new Error('syncBoom'),
    });
    expect(result).toEqual({ error: 'syncBoom' });
  });

  it('a queue whose method throws refuses and rolls back', async () => {
    await asyncGlobalState.runWithInstanceState(async () => {
      const engine: any = asyncEngine();
      engine.importMethods(methods);
      await engine.setState([{ tournamentId: 'T', tournamentName: 'original' }]);
      await engine.setTournamentId('T');

      const result: any = await engine.executionQueue(
        [{ method: 'rename', params: { name: 'before-throw' } }, { method: 'syncBoom' }],
        true,
      );
      expect(result.error).toEqual('syncBoom');
      expect(result.rolledBack).toEqual(true);
      const { tournamentRecord } = await engine.getTournament({ tournamentId: 'T' });
      expect(tournamentRecord.tournamentName).toEqual('original');
    });
  });
});
