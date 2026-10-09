import { mocksEngine, tournamentEngine, globalState, topicConstants } from 'tods-competition-factory';

import { subscriptionHandlers } from './getMutationEngine';
import { runWithRequestContext } from './requestContext';

/**
 * INTEGRATION: real publish notices, as in noticeEviction.integration.spec.ts.
 *
 * Publishing changes what the public may see of a draw, its structures and its rounds, and
 * courthive-public reads those through the draw (`gdd|`) and structure (`gsd|`) tiers. The handlers
 * evicted only the event tier, so a structure withheld through TMX stayed visible from cache for the
 * full TTL. Found by the Guidon publishing journey (CFS + TMX + courthive-public).
 */
describe('publishing evicts the draw and structure tiers', () => {
  function capture(run: () => void) {
    const evicted = new Set<string>();
    const unnarrowable = new Set<string>();
    const subscriptions: any = {};
    for (const topic of Object.values(topicConstants)) {
      if (typeof topic !== 'string') continue;
      const handler = subscriptionHandlers[topic];
      if (!handler) continue;
      subscriptions[topic] = (params: any[]) =>
        runWithRequestContext(
          { evictedEventKeys: evicted, unnarrowablePrefixes: unnarrowable, publicNotices: [] },
          () => handler(params),
        );
    }
    globalState.setSubscriptions({ subscriptions });
    try {
      run();
    } finally {
      globalState.setSubscriptions({ subscriptions: {} });
    }
    return { evicted: [...evicted], unnarrowable: [...unnarrowable] };
  }

  function qualifyingDraw() {
    const {
      drawIds: [drawId],
      eventIds: [eventId],
    } = mocksEngine.generateTournamentRecord({
      drawProfiles: [
        { drawSize: 16, qualifyingProfiles: [{ structureProfiles: [{ drawSize: 16, qualifyingPositions: 4 }] }] },
      ],
      participantsProfile: { nonRandom: 1 },
      setState: true,
    });
    const { drawDefinition } = tournamentEngine.getEvent({ drawId });
    const structureIdOf = (stage: string) => drawDefinition.structures.find((s: any) => s.stage === stage).structureId;
    return { eventId, drawId, qualifyingId: structureIdOf('QUALIFYING'), mainId: structureIdOf('MAIN') };
  }

  it('withholding a structure sweeps both tiers', () => {
    const { eventId, drawId, qualifyingId, mainId } = qualifyingDraw();
    // control: the event is published first, outside the capture
    expect(tournamentEngine.publishEvent({ eventId }).success).toEqual(true);

    const { unnarrowable } = capture(() => {
      const result: any = tournamentEngine.publishEvent({
        drawDetails: {
          [drawId]: {
            publishingDetail: { published: true },
            structureDetails: { [qualifyingId]: { published: true }, [mainId]: { published: false } },
          },
        },
        eventId,
      });
      expect(result.success).toEqual(true);
    });

    expect(unnarrowable).toEqual(expect.arrayContaining(['gdd|', 'gsd|']));
  });

  it('unpublishing an event sweeps both tiers', () => {
    const { eventId } = qualifyingDraw();
    expect(tournamentEngine.publishEvent({ eventId }).success).toEqual(true);

    const { unnarrowable, evicted } = capture(() => {
      expect(tournamentEngine.unPublishEvent({ eventId }).success).toEqual(true);
    });

    expect(unnarrowable).toEqual(expect.arrayContaining(['gdd|', 'gsd|']));
    // control: the handler ran at all, so the sweep above is its doing
    expect(evicted.some((key) => key.startsWith('ged|'))).toEqual(true);
  });
});
