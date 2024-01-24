export const messages = {
  executionQueue: ({ client, payload }) => {
    client.emit('ack', { received: !!payload });
    console.log('executionQueue', payload);
    return true;
  },
  fetch: ({ client, payload }) => {
    client.emit('ack', { received: !!payload });
    return true;
  },
};
