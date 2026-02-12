import { executionQueue } from 'src/modules/factory/functions/private/executionQueue';

import type { TournamentStorageService } from 'src/storage/tournament-storage.service';

export const tmxMessages = {
  executionQueue: async ({ client, payload, services, storage }: { client: any; payload: any; services: any; storage: TournamentStorageService }) => {
    const result = await executionQueue(payload, services, storage);
    const ackId = payload.ackId;

    const response = result.error ? { ackId, error: result.error } : { ackId, success: result.success };
    client.emit('ack', response);
    return response;
  },
};
