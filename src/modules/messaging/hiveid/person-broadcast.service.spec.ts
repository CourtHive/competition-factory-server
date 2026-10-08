import { RecordingRealtime } from 'src/tests/helpers/recordingRealtime';
import { PersonBroadcastService } from './person-broadcast.service';

// Moved with broadcastPersonUpdate from hiveid.gateway.spec.ts; same two cases, asserted on the port.
describe('PersonBroadcastService', () => {
  let realtime: RecordingRealtime;
  let service: PersonBroadcastService;

  beforeEach(() => {
    realtime = new RecordingRealtime();
    service = new PersonBroadcastService(realtime);
  });

  it('emits personUpdate to the person room', () => {
    service.broadcastPersonUpdate('p-1', { type: 'refresh' });
    expect(realtime.published).toEqual([
      {
        channel: { namespace: 'hiveid', room: 'hiveid:person:p-1' },
        event: 'personUpdate',
        payload: { type: 'refresh' },
      },
    ]);
  });

  it('no-ops on missing personId or payload', () => {
    service.broadcastPersonUpdate('', { type: 'refresh' });
    service.broadcastPersonUpdate('p-1', undefined);
    expect(realtime.published).toHaveLength(0);
  });
});
