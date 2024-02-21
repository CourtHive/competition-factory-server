import { executionQueue } from 'src/modules/factory/functions/private/executionQueue';

export const tmxMessages = {
  executionQueue: async ({ client, payload, services }) => {
    const result = await executionQueue(payload, services);
    const ackId = payload.ackId;

    const response = result.error ? { ackId, error: result.error } : { ackId, success: result.success };
    client.emit('ack', response);
  },
};
