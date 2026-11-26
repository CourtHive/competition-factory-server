import { mocksEngine } from 'tods-competition-factory';
import { executionQueue } from './executionQueue';

import type { TournamentStorageService } from 'src/storage/tournament-storage.service';

/**
 * A REFUSED QUEUE HAS NO EXTERNAL EFFECT, AND SAYS IT WAS ROLLED BACK. The engine runs with rollback off whatever the
 * caller sent: the server saves a queue only when it succeeds, and discards the request's records otherwise, so the
 * stored record is the rollback. A refused queue is never saved, records no draw deletion, updates no provider
 * calendar and announces nothing (the controller and the HTTP delivery broadcast only a successful result). The
 * caller is told `rolledBack: true`, with no `committed` and no results claiming that earlier directives persisted.
 * The mutation's own audit-log row still records the attempt, as `rejected`.
 */

const h = vi.hoisted(() => ({ flags: [] as unknown[] }));
vi.mock('../../engines/getMutationEngine', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    getMutationEngine: () => {
      const engine = actual.getMutationEngine();
      return new Proxy(engine, {
        get: (target, key) =>
          key === 'executionQueue'
            ? (...args: unknown[]) => {
                h.flags.push(args[1]);
                return target.executionQueue(...args);
              }
            : target[key],
      });
    },
  };
});

const providerId = 'provider-refused';
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
  return {
    fetchTournamentRecords: vi.fn(async () => ({
      success: true,
      tournamentRecords: { [tournamentId]: structuredClone(template) },
    })),
    saveTournamentRecords: vi.fn(async () => ({ success: true })),
    modifyProviderCalendar: vi.fn(async () => ({ success: true })),
  };
}

function audit() {
  return { recordMutation: vi.fn(async () => undefined), recordDrawDeletion: vi.fn(async () => undefined) };
}

const deleteDraw = { method: 'deleteDrawDefinitions', params: { eventId, drawIds: [drawId] } };
const rename = { method: 'setTournamentName', params: { tournamentName: 'Renamed' } };
// the second court id is unknown: the first court is deleted and the call is refused with `committed: true`
const partlyCommitted = { method: 'deleteCourts', params: { courtIds: [courtIds[0], 'unknown-court'] } };
const unknownMatchUp = {
  method: 'setMatchUpStatus',
  params: { drawId, matchUpId: 'unknown-matchUp', outcome: { matchUpStatus: 'COMPLETED', winningSide: 1 } },
};

async function run(methods: any[], rollbackOnError?: boolean) {
  const persisted = storage();
  const auditService = audit();
  const result: any = await executionQueue(
    { tournamentIds: [tournamentId], methods, ...(rollbackOnError === undefined ? {} : { rollbackOnError }) },
    undefined,
    persisted as unknown as TournamentStorageService,
    auditService as any,
  );
  // the effects are not awaited by the queue; let them settle
  await new Promise((resolve) => setImmediate(resolve));
  return { result, persisted, auditService };
}

function expectNoExternalEffect({ result, persisted, auditService }: Awaited<ReturnType<typeof run>>) {
  expect(result.success).toBeUndefined();
  expect(persisted.saveTournamentRecords).not.toHaveBeenCalled();
  expect(auditService.recordDrawDeletion).not.toHaveBeenCalled();
  expect(persisted.modifyProviderCalendar).not.toHaveBeenCalled();
  expect(result.publicNotices).toEqual([]);
  // the attempt itself is logged, as refused
  expect(auditService.recordMutation).toHaveBeenCalledTimes(1);
  expect(auditService.recordMutation).toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected' }));
}

beforeEach(() => {
  h.flags.length = 0;
});
afterEach(() => vi.restoreAllMocks());

describe.each([true, false, undefined])('the caller sends rollbackOnError %s', (rollbackOnError) => {
  it('the engine runs with rollback off', async () => {
    await run([rename], rollbackOnError);
    expect(h.flags).toEqual([undefined]);
  });

  it('a queue refused after part of it committed has no external effect and reports a rollback', async () => {
    const outcome = await run([deleteDraw, rename, partlyCommitted], rollbackOnError);
    expectNoExternalEffect(outcome);
    const { result } = outcome;
    expect(result.error).toBeDefined();
    expect(result.rolledBack).toBe(true);
    expect(result.committed).toBeUndefined();
    // nothing is reported as kept: an engine that returns the bulk directive's items has them reported rolled back
    for (const item of result.results ?? []) {
      expect(item.success).toBeUndefined();
      expect(item.rolledBack === true || !!item.error).toBe(true);
    }
  });

  it('a queue refused by an ordinary refusal has no external effect and reports a rollback', async () => {
    const outcome = await run([deleteDraw, rename, unknownMatchUp], rollbackOnError);
    expectNoExternalEffect(outcome);
    const { result } = outcome;
    expect(result.error).toBeDefined();
    expect(result.rolledBack).toBe(true);
    expect(result.committed).toBeUndefined();
    // the directives before the refusal were not stored, so none is reported
    expect(result.results).toBeUndefined();
  });

  it('a queue that succeeds is saved and reported as before', async () => {
    const { result, persisted, auditService } = await run([deleteDraw, rename], rollbackOnError);
    expect(result.success).toBe(true);
    expect(result.rolledBack).toBeUndefined();
    expect(result.results.map(({ methodName }) => methodName)).toEqual(['deleteDrawDefinitions', 'setTournamentName']);
    expect(persisted.saveTournamentRecords).toHaveBeenCalledTimes(1);
    expect(auditService.recordDrawDeletion).toHaveBeenCalledTimes(1);
    expect(persisted.modifyProviderCalendar).toHaveBeenCalledTimes(1);
    expect(auditService.recordMutation).toHaveBeenCalledWith(expect.objectContaining({ status: 'applied' }));
  });
});
