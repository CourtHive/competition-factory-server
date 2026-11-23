import { queryTournamentRecords } from '../functions/private/queryTournamentRecords';
import { factoryConstants, globalState } from 'tods-competition-factory';
import asyncGlobalState from './asyncGlobalState';
import './queryEngine';

import type { ITournamentStorage } from 'src/storage/interfaces';

// Imports the query engine without the mutation engine: the read path must not depend on getMutationEngine having
// been loaded first to get per-request state.
it('installs the per-request state provider on its own', () => {
  expect(globalState.getProvider()).toBe(asyncGlobalState);
});

it('refuses a fetch whose keys do not match the records it holds', async () => {
  const storage = {
    fetchTournamentRecords: async () => ({ tournamentRecords: { 't-1': { tournamentId: 't-2' } } }),
  } as unknown as ITournamentStorage;
  const result: any = await queryTournamentRecords({ tournamentId: 't-1', method: 'getTournamentInfo' }, storage);
  expect(result.error).toEqual(factoryConstants.errorConditionConstants.INVALID_RECORDS);
});
