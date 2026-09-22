import { mocksEngine, tournamentEngine, globalState, topicConstants } from 'tods-competition-factory';

import { createDeltaBuffer } from '../projection/deltaBuffer';
import { subscriptionHandlers } from './getMutationEngine';
import { runWithRequestContext } from './requestContext';

/**
 * INTEGRATION — the information publish, through the real factory.
 *
 * The wiring spec feeds these handlers `{ tournamentId }` by hand, which proves the subscription exists
 * and nothing about what factory actually emits. This drives `publishTournamentInfo` /
 * `unPublishTournamentInfo` for real: if either notice stopped carrying `tournamentId`, the handler would
 * record no intent, the tournaments row would never refresh, and only this spec would notice.
 *
 * The tournament here has NO draws — the registration-phase shape the publish exists for, and the one
 * case where no other topic fires to refresh the row.
 */
describe('tournament information notices, against the real factory', () => {
  function capture(run: () => void) {
    const buffer = createDeltaBuffer(['*']);
    const publicNotices: any[] = [];
    const subscriptions: any = {};
    for (const topic of Object.values(topicConstants)) {
      if (typeof topic !== 'string') continue;
      const handler = subscriptionHandlers[topic];
      if (!handler) continue;
      subscriptions[topic] = (params: any[]) =>
        runWithRequestContext({ deltaBuffer: buffer, publicNotices }, () => handler(params));
    }
    globalState.setSubscriptions({ subscriptions });
    try {
      run();
    } finally {
      globalState.setSubscriptions({ subscriptions: {} });
    }
    return { intents: buffer.intents, publicNotices };
  }

  function seedDrawlessTournament(): string {
    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      eventProfiles: [{ eventName: 'Open Singles' }],
      participantsProfile: { nonRandom: 1 },
      setState: true,
    });
    return tournamentRecord.tournamentId;
  }

  it('publishing information touches the tournament, so tournaments.published is re-projected', () => {
    const tournamentId = seedDrawlessTournament();

    const { intents, publicNotices } = capture(() => {
      const result: any = tournamentEngine.publishTournamentInfo();
      expect(result.success).toEqual(true);
    });

    expect(intents).toContainEqual({ kind: 'touchTournament', tournamentId });
    expect(publicNotices).toContainEqual({ topic: topicConstants.PUBLISH_TOURNAMENT_INFO, tournamentId });
  });

  it('withdrawing it touches the tournament again, and reports the tournament went dark', () => {
    const tournamentId = seedDrawlessTournament();
    tournamentEngine.publishTournamentInfo();

    const { intents, publicNotices } = capture(() => {
      const result: any = tournamentEngine.unPublishTournamentInfo();
      expect(result.success).toEqual(true);
    });

    expect(intents).toContainEqual({ kind: 'touchTournament', tournamentId });
    expect(publicNotices).toContainEqual({ topic: topicConstants.UNPUBLISH_TOURNAMENT_INFO, tournamentId });
    // nothing else is published, so the factory also reports the tournament as no longer published
    expect(intents.filter((intent: any) => intent.kind === 'touchTournament').length).toBeGreaterThan(1);
  });

  it('the published flag the read model would write follows the publish', () => {
    seedDrawlessTournament();
    const record = () => tournamentEngine.getTournament().tournamentRecord;

    // control: a tournament with no draws and nothing published is not published
    expect(tournamentEngine.getPublishState().publishState.tournament.status.published).toEqual(false);

    tournamentEngine.publishTournamentInfo();
    expect(tournamentEngine.getPublishState().publishState.tournament.status.published).toEqual(true);
    expect(record().timeItems?.length).toBeGreaterThan(0);
  });
});
