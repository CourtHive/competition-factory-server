import { mocksEngine, tournamentEngineAsync, factoryConstants } from 'tods-competition-factory';
import { executionQueue } from './executionQueue';

import type { TournamentStorageService } from 'src/storage/tournament-storage.service';

/**
 * The mutation path works on the fetched records themselves: one copy for the rollback snapshot
 * (the factory's), none for loading, saving or projecting. Storage hands every fetch its own
 * objects (ITournamentStorage.fetchTournamentRecords), which is what makes that safe.
 */

const { tournamentRecord: template } = mocksEngine.generateTournamentRecord({
  eventProfiles: [{ eventName: 'E', drawProfiles: [{ drawSize: 4 }] }],
});
const tournamentId = template.tournamentId;

function storage(records = () => ({ [tournamentId]: structuredClone(template) })) {
  const fetched: Record<string, any>[] = [];
  return {
    fetched,
    fetchTournamentRecords: vi.fn(async () => {
      const tournamentRecords = records();
      fetched.push(tournamentRecords);
      return { success: true, tournamentRecords };
    }),
    saveTournamentRecords: vi.fn<(params: { tournamentRecords: Record<string, any> }) => Promise<{ success: boolean }>>(
      async () => ({ success: true }),
    ),
  };
}

const run = (payload: any, persisted: ReturnType<typeof storage>, services?: any) =>
  executionQueue(payload, services, persisted as unknown as TournamentStorageService);

afterEach(() => vi.restoreAllMocks());

it('saves the fetched record itself, mutated, without copying it', async () => {
  const persisted = storage();
  const result: any = await run(
    {
      tournamentIds: [tournamentId],
      methods: [{ method: 'setTournamentName', params: { tournamentName: 'Borrowed' } }],
    },
    persisted,
  );
  expect(result.success).toBe(true);

  const fetchedRecord = persisted.fetched[0][tournamentId];
  const saved = persisted.saveTournamentRecords.mock.calls[0][0];
  expect(saved.tournamentRecords[tournamentId]).toBe(fetchedRecord);
  expect(fetchedRecord.tournamentName).toBe('Borrowed');
});

it('saves nothing when the queue is rolled back', async () => {
  const persisted = storage();
  const result: any = await run(
    {
      tournamentIds: [tournamentId],
      rollbackOnError: true,
      methods: [
        { method: 'setTournamentName', params: { tournamentName: 'Discarded' } },
        { method: 'setTournamentDates', params: { startDate: 'not a date' } },
      ],
    },
    persisted,
  );
  expect(result.rolledBack).toBe(true);
  expect(persisted.saveTournamentRecords).not.toHaveBeenCalled();
});

it('refuses records whose keys are not their tournamentIds, as setState did', async () => {
  const persisted = storage(() => ({ wrongKey: structuredClone(template) }));
  const result: any = await run(
    { tournamentIds: ['wrongKey'], methods: [{ method: 'setTournamentName', params: { tournamentName: 'X' } }] },
    persisted,
  );
  expect(result.error).toEqual(factoryConstants.errorConditionConstants.INVALID_RECORDS);
  expect(persisted.saveTournamentRecords).not.toHaveBeenCalled();
});

it('projects a new draw from the saved record without loading a copy per draw', async () => {
  const withoutDraw = () => {
    const record = structuredClone(template);
    record.events[0].drawDefinitions = [];
    return { [tournamentId]: record };
  };
  const drawDefinition = structuredClone(template.events[0].drawDefinitions[0]);
  const eventId = template.events[0].eventId;

  const persisted = storage(withoutDraw);
  const projectionOutbox = { isEnabled: true, enqueue: vi.fn(async () => undefined) };
  const setState = vi.spyOn(tournamentEngineAsync, 'setState');

  const result: any = await run(
    { tournamentIds: [tournamentId], methods: [{ method: 'addDrawDefinition', params: { drawDefinition, eventId } }] },
    persisted,
    { projectionOutbox },
  );
  expect(result.success).toBe(true);
  expect(setState).not.toHaveBeenCalled();

  const deltas = (projectionOutbox.enqueue.mock.calls[0] as any)[0];
  const matchUpRows = deltas.filter((delta) => delta.table === 'match_ups');
  expect(matchUpRows).toHaveLength(3); // a draw of 4: two semifinals and a final
  expect(matchUpRows.every((delta) => delta.tournamentId === tournamentId)).toBe(true);
});
