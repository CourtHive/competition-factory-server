import { mocksEngine } from 'tods-competition-factory';
import { executionQueue } from './executionQueue';

import type { TournamentStorageService } from 'src/storage/tournament-storage.service';

/**
 * A notice's external effects (a draw-deletion audit row, a provider calendar update) describe work the server keeps
 * only once the records are saved. A queue refused with rollback off saves nothing, even when the engine delivered
 * the notices of work it had committed before the refusal, so none of those effects may run.
 */

const providerId = 'provider-effects';
const { tournamentRecord: template } = mocksEngine.generateTournamentRecord({
  tournamentAttributes: {
    parentOrganisation: { organisationId: providerId, organisationName: 'P', organisationAbbreviation: 'P' },
  },
  eventProfiles: [{ eventName: 'E', drawProfiles: [{ drawSize: 4 }] }],
  venueProfiles: [{ courtsCount: 2 }],
});
const tournamentId = template.tournamentId;
const event = template.events?.[0];
const eventId = event?.eventId;
const drawId = event?.drawDefinitions?.[0]?.drawId;
const courtIds = (template.venues?.[0]?.courts ?? []).map(({ courtId }) => courtId);

function storage() {
  const order: string[] = [];
  return {
    order,
    fetchTournamentRecords: vi.fn(async () => ({
      success: true,
      tournamentRecords: { [tournamentId]: structuredClone(template) },
    })),
    saveTournamentRecords: vi.fn(async () => {
      order.push('save');
      return { success: true };
    }),
    modifyProviderCalendar: vi.fn(async () => {
      order.push('calendar');
      return { success: true };
    }),
  };
}

function audit(order: string[]) {
  return {
    recordMutation: vi.fn(async () => undefined),
    recordDrawDeletion: vi.fn(async () => {
      order.push('drawDeletion');
    }),
  };
}

const deleteDraw = { method: 'deleteDrawDefinitions', params: { eventId, drawIds: [drawId] } };
const rename = { method: 'setTournamentName', params: { tournamentName: 'Renamed' } };

async function run(methods: any[]) {
  const persisted = storage();
  const auditService = audit(persisted.order);
  const result: any = await executionQueue(
    { tournamentIds: [tournamentId], rollbackOnError: false, methods },
    undefined,
    persisted as unknown as TournamentStorageService,
    auditService as any,
  );
  // the effects are not awaited by the queue; let them settle
  await new Promise((resolve) => setImmediate(resolve));
  return { result, persisted, auditService };
}

afterEach(() => vi.restoreAllMocks());

it('records a draw deletion and a calendar update once the records are saved', async () => {
  const { result, persisted, auditService } = await run([deleteDraw, rename]);
  expect(result.success).toBe(true);
  expect(persisted.saveTournamentRecords).toHaveBeenCalledTimes(1);
  expect(auditService.recordDrawDeletion).toHaveBeenCalledTimes(1);
  expect(persisted.modifyProviderCalendar).toHaveBeenCalledWith(
    expect.objectContaining({
      providerId,
      tournamentId,
      updates: expect.objectContaining({ tournamentName: 'Renamed' }),
    }),
  );
  expect(persisted.order[0]).toBe('save');
});

it('runs no effect when a queue is refused after part of it committed', async () => {
  // the second court id is unknown: the first court is deleted and the call is refused with `committed: true`
  const partial = { method: 'deleteCourts', params: { courtIds: [courtIds[0], 'unknown-court'] } };
  const { result, persisted, auditService } = await run([deleteDraw, rename, partial]);
  expect(result.success).toBeUndefined();
  expect(result.error).toBeDefined();
  expect(persisted.saveTournamentRecords).not.toHaveBeenCalled();
  expect(auditService.recordDrawDeletion).not.toHaveBeenCalled();
  expect(persisted.modifyProviderCalendar).not.toHaveBeenCalled();
  expect(result.publicNotices).toEqual([]);
});

it('runs no effect when a queue is refused outright', async () => {
  const refused = { method: 'deleteCourts', params: { courtIds: ['unknown-court'] } };
  const { result, persisted, auditService } = await run([deleteDraw, rename, refused]);
  expect(result.error).toBeDefined();
  expect(persisted.saveTournamentRecords).not.toHaveBeenCalled();
  expect(auditService.recordDrawDeletion).not.toHaveBeenCalled();
  expect(persisted.modifyProviderCalendar).not.toHaveBeenCalled();
});
