import { topicConstants } from 'tods-competition-factory';

import { runWithRequestContext } from './requestContext';
import { createDeltaBuffer } from '../projection/deltaBuffer';
import { subscriptionHandlers } from './getMutationEngine';

// The topic→recorder map is registered ONCE at module load via globalState.setGlobalSubscriptions,
// so it can no longer be captured by spying on a per-request setSubscriptions call. The map is
// exported instead; drive a handler directly inside a request context with a real delta buffer and
// assert the intended projection intent is recorded.
// This guards the SUBSCRIPTION WIRING itself (a missing/removed subscribe line fails here),
// which the buildProjectionDeltas / conformance specs — fed intents directly — cannot catch.
describe('getMutationEngine — projection subscription wiring', () => {
  function fire(topic: string, buffer: ReturnType<typeof createDeltaBuffer>, params: any[]): void {
    expect(typeof subscriptionHandlers[topic]).toBe('function');
    runWithRequestContext({ deltaBuffer: buffer, publicNotices: [] }, () => subscriptionHandlers[topic](params));
  }

  it('PUBLISH_EVENT_SEEDING is subscribed and records an events intent', () => {
    const buffer = createDeltaBuffer(['t1']);
    fire(topicConstants.PUBLISH_EVENT_SEEDING, buffer, [{ tournamentId: 't1', eventId: 'e1' }]);
    expect(buffer.intents).toContainEqual({ kind: 'events', tournamentId: 't1' });
  });

  it('UNPUBLISH_EVENT_SEEDING is subscribed and records an events intent', () => {
    const buffer = createDeltaBuffer(['t1']);
    fire(topicConstants.UNPUBLISH_EVENT_SEEDING, buffer, [{ tournamentId: 't1', eventId: 'e1' }]);
    expect(buffer.intents).toContainEqual({ kind: 'events', tournamentId: 't1' });
  });
});
