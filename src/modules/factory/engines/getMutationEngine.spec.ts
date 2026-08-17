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

// Cache-eviction attribution. These handlers decide which per-entity cache keys the controller is
// allowed to SPARE, so a handler that cannot attribute a change must say so — silence is read as
// "nothing changed at that grain".
describe('getMutationEngine — cache eviction attribution', () => {
  function fireWithContext(topic: string, params: any[]) {
    const evictedEventKeys = new Set<string>();
    const unnarrowablePrefixes = new Set<string>();
    runWithRequestContext({ evictedEventKeys, unnarrowablePrefixes, publicNotices: [] }, () =>
      subscriptionHandlers[topic](params),
    );
    return { evicted: [...evictedEventKeys], unnarrowable: [...unnarrowablePrefixes] };
  }

  it('MODIFY_MATCHUP without a structureId reports the structure tier as unnarrowable', () => {
    // This is the real shape of the notice today: factory declares `structureId` on the envelope but
    // 57 of its 61 modifyMatchUpNotice call sites never pass one — including every score path.
    const { evicted, unnarrowable } = fireWithContext(topicConstants.MODIFY_MATCHUP, [
      { tournamentId: 't1', eventId: 'e1', drawId: 'd1', matchUp: { matchUpId: 'm1' } },
    ]);

    expect(unnarrowable).toContain('gsd|');
    // the tier it CAN attribute is still targeted precisely
    expect(evicted).toContain('gdd|t1|d1');
    // and nothing bogus is evicted in place of the id it lacks
    expect(evicted).not.toContain('gsd|t1|undefined');
    // NOTE: the EVENT tier is evicted by MODIFY_DRAW_DEFINITION, which carries eventId and fires on
    // the same mutation. Asserted separately below rather than assumed here.
  });

  it('MODIFY_MATCHUP with a structureId targets the structure and claims nothing unnarrowable', () => {
    // Proves the assertion above can change value — it is not just agreeing with a constant.
    const { evicted, unnarrowable } = fireWithContext(topicConstants.MODIFY_MATCHUP, [
      { tournamentId: 't1', eventId: 'e1', drawId: 'd1', structureId: 's1', matchUp: { matchUpId: 'm1' } },
    ]);

    expect(evicted).toContain('gsd|t1|s1');
    expect(unnarrowable).toEqual([]);
  });

  it('MODIFY_DRAW_DEFINITION evicts the event AND draw tiers, taking drawId from the nested draw', () => {
    const { evicted, unnarrowable } = fireWithContext(topicConstants.MODIFY_DRAW_DEFINITION, [
      { tournamentId: 't1', eventId: 'e1', drawDefinition: { drawId: 'd1' } },
    ]);

    expect(evicted).toContain('ged|t1|e1');
    // this topic has no top-level drawId; reading only `item.drawId` silently evicted nothing
    expect(evicted).toContain('gdd|t1|d1');
    expect(unnarrowable).toEqual([]);
  });

  it('MODIFY_POSITION_ASSIGNMENTS attributes the DESTINATION structure of a cross-structure move', () => {
    // Verified against factory: a compass/FMLC loser landing in another structure emits this topic
    // carrying the destination structureId, which is how propagation targets get evicted at all.
    const { evicted } = fireWithContext(topicConstants.MODIFY_POSITION_ASSIGNMENTS, [
      { tournamentId: 't1', eventId: 'e1', drawId: 'd1', structureId: 'destStructure' },
    ]);

    expect(evicted).toContain('gsd|t1|destStructure');
  });
});
