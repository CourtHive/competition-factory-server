import { globalState, topicConstants } from 'tods-competition-factory';

import { createDeltaBuffer } from '../projection/deltaBuffer';
import { getMutationEngine } from './getMutationEngine';

// getMutationEngine registers its topic→recorder map via globalState.setSubscriptions.
// Spy on that call to capture the map, then invoke a handler directly with a fake notice
// payload + a real delta buffer, asserting the intended projection intent is recorded.
// This guards the SUBSCRIPTION WIRING itself (a missing/removed subscribe line fails here),
// which the buildProjectionDeltas / conformance specs — fed intents directly — cannot catch.
describe('getMutationEngine — projection subscription wiring', () => {
  function captureSubscriptions(deltaBuffer: ReturnType<typeof createDeltaBuffer>): Record<string, any> {
    const spy = jest.spyOn(globalState, 'setSubscriptions');
    getMutationEngine(undefined, [], deltaBuffer);
    const calls = spy.mock.calls;
    const call = calls[calls.length - 1][0] as any;
    spy.mockRestore();
    return call.subscriptions;
  }

  it('PUBLISH_EVENT_SEEDING is subscribed and records an events intent', () => {
    const buffer = createDeltaBuffer(['t1']);
    const subs = captureSubscriptions(buffer);
    expect(typeof subs[topicConstants.PUBLISH_EVENT_SEEDING]).toBe('function');
    subs[topicConstants.PUBLISH_EVENT_SEEDING]([{ tournamentId: 't1', eventId: 'e1' }]);
    expect(buffer.intents).toContainEqual({ kind: 'events', tournamentId: 't1' });
  });

  it('UNPUBLISH_EVENT_SEEDING is subscribed and records an events intent', () => {
    const buffer = createDeltaBuffer(['t1']);
    const subs = captureSubscriptions(buffer);
    expect(typeof subs[topicConstants.UNPUBLISH_EVENT_SEEDING]).toBe('function');
    subs[topicConstants.UNPUBLISH_EVENT_SEEDING]([{ tournamentId: 't1', eventId: 'e1' }]);
    expect(buffer.intents).toContainEqual({ kind: 'events', tournamentId: 't1' });
  });
});
