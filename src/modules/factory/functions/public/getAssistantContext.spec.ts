/**
 * The assistant context reads the fields `getTournamentInfo` returns: the events on `eventInfo` and the counts on
 * `matchUpStats`. It used to read `events`, `matchUpCounts` and a tournament `category`, none of which the factory
 * returns, so its events were always empty and its schedule status absent; factory 7.25.0's result types (#5986)
 * surfaced it. Uses an in-memory storage stub.
 */
import { mocksEngine } from 'tods-competition-factory';
import { getAssistantContext } from './getAssistantContext';

import type { ITournamentStorage } from 'src/storage/interfaces';

const TEST_TID = 'test-assistant-context';

function storageHolding(tournamentRecord: any) {
  return {
    findTournamentRecord: async ({ tournamentId }: { tournamentId: string }) =>
      tournamentId === TEST_TID ? { tournamentRecord } : { error: 'NOT_FOUND' },
  } as unknown as ITournamentStorage;
}

describe('getAssistantContext', () => {
  it('lists the events and the schedule status getTournamentInfo returns', async () => {
    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      tournamentAttributes: { tournamentId: TEST_TID },
      eventProfiles: [
        { eventName: 'Singles', drawProfiles: [{ drawSize: 8 }] },
        { eventName: 'Doubles', eventType: 'DOUBLES', drawProfiles: [{ drawSize: 4 }] },
      ],
      completeAllMatchUps: true,
    });

    const result: any = await getAssistantContext({ tournamentId: TEST_TID }, storageHolding(tournamentRecord));

    expect(result.success).toEqual(true);
    const { tournament, events, scheduleStatus } = result.assistantContext;
    expect(tournament.tournamentName).toEqual(tournamentRecord.tournamentName);
    expect(events.map((event: any) => event.eventName).sort()).toEqual(['Doubles', 'Singles']);
    for (const event of events) {
      expect(event.drawsCount).toEqual(1);
      expect(event.entriesCount).toBeGreaterThan(0);
    }
    // 7 + 3 matchUps, every one completed
    expect(scheduleStatus.totalMatchUps).toEqual(10);
    expect(scheduleStatus.completedMatchUps).toEqual(10);
    expect(scheduleStatus.percentComplete).toEqual(100);
  });

  it('passes a missing tournament through as its error', async () => {
    const result: any = await getAssistantContext({ tournamentId: 'absent' }, storageHolding(undefined));
    expect(result.error).toBeDefined();
  });
});
