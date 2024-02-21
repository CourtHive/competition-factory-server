import { executionQueue } from 'src/modules/factory/functions/private/executionQueue';

export const tmxMessages = {
  executionQueue: async ({ client, payload, services }) => {
    const result = await executionQueue(payload, services);
    const response = result.error ? { error: result.error } : { success: result.success };
    client.emit('ack', response);
  },
};
