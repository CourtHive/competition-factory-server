import { mocksEngine, tournamentEngine, globalState, topicConstants } from 'tods-competition-factory';

import { runWithRequestContext } from './requestContext';
import { subscriptionHandlers } from './getMutationEngine';

/**
 * INTEGRATION — real factory notices, not hand-written payloads.
 *
 * The rest of this module's specs feed subscriptionHandlers synthetic params. That is how a
 * serve-stale bug shipped in #906: the mocks asserted a `structureId` the real notice did not
 * carry, so every unit test passed while every score left the structure cache tier stale.
 *
 * These tests drive an actual mutation through the actual factory and assert on what the handlers
 * genuinely receive. If factory stops populating an id, this fails and the mocks do not.
 */
describe('cache eviction against real factory notices', () => {
  function runScore(drawType: string) {
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

    const {
      tournamentRecord,
      drawIds: [drawId],
    } = mocksEngine.generateTournamentRecord({
      drawProfiles: [{ drawSize: 8, drawType }],
      participantsProfile: { nonRandom: 1 },
      setState: true,
    });
    const tournamentId = tournamentRecord.tournamentId;

    const matchUps: any[] = tournamentEngine.allTournamentMatchUps().matchUps ?? [];
    const target: any = matchUps.find(
      (m: any) => !m.winningSide && (m.sides ?? []).filter((s: any) => s?.participantId).length === 2,
    );
    const { outcome } = mocksEngine.generateOutcomeFromScoreString({
      scoreString: '6-4 6-2',
      matchUpStatus: 'COMPLETED',
      winningSide: 1,
    });
    const result: any = tournamentEngine.setMatchUpStatus({ matchUpId: target.matchUpId, drawId, outcome });
    expect(result.success).toEqual(true);
    expect(matchUps.length).toBeGreaterThan(0);

    globalState.setSubscriptions({ subscriptions: {} });
    return { evicted: [...evicted], unnarrowable: [...unnarrowable], tournamentId, drawId, target, matchUps };
  }

  it('a score names the structure it changed — no tier is left unattributable', () => {
    const { evicted, unnarrowable, tournamentId, drawId, target } = runScore('SINGLE_ELIMINATION');

    // The regression: before factory #4647 this was ['gsd|'] and the whole tier had to be swept.
    expect(unnarrowable).toEqual([]);
    expect(evicted).toContain(`gsd|${tournamentId}|${target.structureId}`);
    expect(evicted).toContain(`gdd|${tournamentId}|${drawId}`);
  });

  it('a cross-structure loser evicts BOTH the source and the destination structure', () => {
    // Compass sends the loser into a different structure. The source moves because the matchUp was
    // scored; the destination moves because a participant was positioned into it. Missing either
    // one serves a stale bracket.
    const { evicted, unnarrowable, tournamentId, target, matchUps } = runScore('COMPASS');
    const byId = Object.fromEntries(matchUps.map((m: any) => [m.matchUpId, m]));
    const loserDest = byId[target.loserMatchUpId];

    expect(loserDest?.structureId).toBeDefined();
    expect(loserDest.structureId).not.toEqual(target.structureId); // guard: this really is cross-structure
    expect(unnarrowable).toEqual([]);
    expect(evicted).toContain(`gsd|${tournamentId}|${target.structureId}`);
    expect(evicted).toContain(`gsd|${tournamentId}|${loserDest.structureId}`);
  });

  it('round robin reports the GROUP structure, matching the inContext vocabulary', () => {
    const { evicted, unnarrowable, tournamentId, target } = runScore('ROUND_ROBIN');

    expect(unnarrowable).toEqual([]);
    expect(evicted).toContain(`gsd|${tournamentId}|${target.structureId}`);
  });
});
