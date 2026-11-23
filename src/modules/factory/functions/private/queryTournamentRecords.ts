import asyncGlobalState from 'src/modules/factory/engines/asyncGlobalState';
import { loadFetchedRecords } from 'src/modules/factory/helpers/loadFetchedRecords';
import { queryEngine } from 'src/modules/factory/engines/queryEngine';
import { Logger } from '@nestjs/common';

import type { ITournamentStorage } from 'src/storage/interfaces';

export async function queryTournamentRecords(payload, storage: ITournamentStorage) {
  const tournamentIds = payload?.tournamentIds || (payload?.tournamentId && [payload.tournamentId]) || [];

  if (!tournamentIds.length) {
    Logger.error('No tournamentRecord provided');
    return { error: 'No tournamentIds provided' };
  }

  const result: any = await storage.fetchTournamentRecords({ tournamentIds });
  if (result.error) return result;

  // DECISION: the read path gets its OWN engine state context.
  // WHY: queryEngine.setState writes the shared factory instance state. Reads take no
  // tournament lock, so before this a query landing inside a mutation's
  // `await mutationEngine.executionQueue(...)` window replaced the records that mutation was
  // working on. One mutation plus one ordinary read was enough. See competition-factory#4564.
  return asyncGlobalState.runWithInstanceState(() => {
    // Without a copy (P67): the factory's default setState deep-copies every record, +101 ms and ~17.5 MB per 2 MB
    // load (Hecaton v1), to protect objects nothing else holds. Same loader as the mutation path.
    const loaded = loadFetchedRecords(result.tournamentRecords);
    if (loaded.error) return loaded;

    const { method, params } = payload;
    if (typeof queryEngine[method] !== 'function') {
      Logger.error(`queryEngine method not found: ${method}`);
      return { error: `Unknown query method: ${method}` };
    }
    return queryEngine[method](params);
  });
}
