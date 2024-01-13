import { saveMatchPoints } from './functions/saveMatchPoints';

export const messages = {
  score: ({ client, payload }) => {
    client.emit('ack', { received: !!payload });
    return true;
  },
  history: ({ client, payload }) => {
    client.emit('ack', { received: !!payload });
    saveMatchPoints(payload);
    return true;
  },
};
