import { executionQueue } from 'src/modules/factory/functions/private/executionQueue';
import { Logger } from '@nestjs/common';

import type { TournamentStorageService } from 'src/storage/tournament-storage.service';

const logger = new Logger('TmxMessages');

export const tmxMessages = {
  executionQueue: async ({ client, payload, services, storage }: { client: any; payload: any; services: any; storage: TournamentStorageService }) => {
    const ackId = payload?.ackId;
    const tournamentIds = payload?.tournamentIds || (payload?.tournamentId && [payload.tournamentId]) || [];

    try {
      const result = await executionQueue(payload, services, storage);

      const response = result.error
        ? { ackId, error: result.error, ...(result.tournamentIds && { tournamentIds: result.tournamentIds }) }
        : { ackId, success: result.success };
      client.emit('ack', response);
      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Unexpected error in executionQueue message: ${message}`);
      const response = { ackId, error: 'Server error', tournamentIds };
      client.emit('ack', response);
      return response;
    }
  },
};
