import asyncGlobalState from 'src/modules/factory/engines/asyncGlobalState';
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
    queryEngine.setState(result.tournamentRecords);

    const { method, params } = payload;
    if (typeof queryEngine[method] !== 'function') {
      Logger.error(`queryEngine method not found: ${method}`);
      return { error: `Unknown query method: ${method}` };
    }
    return queryEngine[method](params);
  });
}
