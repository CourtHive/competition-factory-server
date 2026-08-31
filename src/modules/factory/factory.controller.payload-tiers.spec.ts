import { topicConstants } from 'tods-competition-factory';
import { TournamentBroadcastService } from '../messaging/broadcast/tournament-broadcast.service';
import { MutationAuthorizationService } from './mutation-authorization.service';
import { FactoryController } from './factory.controller';
import { FactoryService } from './factory.service';
import type { Mock } from 'vitest';

/**
 * `drawsProfile` on `POST /factory/eventdata` — the thin-eventData tier of the payload decomposition.
 *
 * DELIBERATELY ITS OWN FILE. `factory.controller.spec.ts` is excluded from the CI command
 * (`pnpm test:unit`) because two of its fifty tests stand up a real Nest module and need Postgres.
 * Specs added there run locally and are invisible to CI — a check that never runs. Everything here
 * constructs the controller directly with mocks, so it is database-free and CI actually gates on it.
 *
 * What these cover is the part a DTO field alone would get wrong: the thin and full responses are
 * DIFFERENT DOCUMENTS, so they need different cache keys and both need evicting.
 */

// These specs cover cache keying, not authorization — an always-allow gate keeps them about one thing.
const permissiveMutationAuth = () => ({ gate: vi.fn().mockResolvedValue(null) }) as any;
const stubGrants = () => ({ forCaller: vi.fn().mockResolvedValue([]) }) as any;
const REQ = { provisioner: undefined, headers: {}, auditSource: undefined };

describe('FactoryController — eventdata payload tiers', () => {
  let controller: FactoryController;
  let service: FactoryService;
  let cache: any;

  const mockResult = { success: true };

  beforeEach(() => {
    vi.clearAllMocks();
    service = {
      getParticipants: vi.fn().mockResolvedValue(mockResult),
      getScheduleMatchUps: vi.fn().mockResolvedValue(mockResult),
      getDrawData: vi.fn().mockResolvedValue(mockResult),
      getEventData: vi.fn().mockResolvedValue(mockResult),
      executionQueue: vi.fn().mockResolvedValue({ success: true, publicNotices: [] }),
    } as unknown as FactoryService;
    const broadcast = {
      broadcastMutation: vi.fn(),
      broadcastPublicNotices: vi.fn(),
    } as unknown as TournamentBroadcastService;
    cache = {
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn(),
      del: vi.fn().mockResolvedValue(undefined),
    };
    controller = new FactoryController(
      service,
      broadcast,
      permissiveMutationAuth() as MutationAuthorizationService,
      stubGrants(),
      cache,
    );
  });

  it('gives the thin and full EVENT payloads separate cache keys', async () => {
    await controller.eventData({ tournamentId: 't1', eventId: 'e1' } as any);
    await controller.eventData({ tournamentId: 't1', eventId: 'e1', drawsProfile: 'STUBS' } as any);

    // Sharing a key would serve a stub list to a caller that asked for brackets, or vice versa —
    // whichever landed in the cache first. Same trap the `gdd|…|s` key already documents.
    const setKeys = cache.set.mock.calls.map((c: any[]) => c[0]);
    expect(setKeys).toContain('ged|t1|e1');
    expect(setKeys).toContain('ged|t1|e1|s');
  });

  it('an unrecognised drawsProfile does NOT get the thin key', async () => {
    await controller.eventData({ tournamentId: 't1', eventId: 'e1', drawsProfile: 'stubs' } as any);

    // The factory rejects unknown values; the key must not pretend otherwise. Lowercase is the
    // realistic typo, and it must land on the FULL key rather than minting a third variant.
    const setKeys = cache.set.mock.calls.map((c: any[]) => c[0]);
    expect(setKeys).toEqual(['ged|t1|e1']);
  });

  it('forwards drawsProfile to the service, and omits the key entirely when not supplied', async () => {
    await controller.eventData({ tournamentId: 't1', eventId: 'e1', drawsProfile: 'STUBS' } as any);
    await controller.eventData({ tournamentId: 't1', eventId: 'e2' } as any);

    const calls = (service.getEventData as Mock).mock.calls;
    expect(calls[0][0].drawsProfile).toBe('STUBS');
    // ADDITIVE: a caller that sends nothing must reach the factory with no drawsProfile at all, so
    // the factory's own FULL default applies rather than a value this layer invented.
    expect(Object.keys(calls[1][0])).not.toContain('drawsProfile');
  });

  it('REGRESSION: hydrateParticipants gets its own EVENT key — it was a live TBD bug', async () => {
    // Not symmetry. hydrateParticipants changes this payload by ~40% (131,728 -> 78,595 bytes on a
    // doubles fixture), courthive-public sends `false`, and GetEventDataDto DEFAULTS it to `true`.
    // Sharing one key meant a caller that omitted the field and lost the 3-minute cache race got
    // sides whose `participant` is a 55-byte stub with no person data — every side renders TBD.
    await controller.eventData({ tournamentId: 't1', eventId: 'e1', hydrateParticipants: true } as any);
    await controller.eventData({ tournamentId: 't1', eventId: 'e1', hydrateParticipants: false } as any);

    const setKeys = cache.set.mock.calls.map((c: any[]) => c[0]);
    expect(setKeys).toContain('ged|t1|e1');
    expect(setKeys).toContain('ged|t1|e1|n');
  });

  it('an omitted hydrateParticipants keeps the bare key — the shape every earlier caller produced', async () => {
    await controller.eventData({ tournamentId: 't1', eventId: 'e1' } as any);

    expect(cache.set.mock.calls.map((c: any[]) => c[0])).toEqual(['ged|t1|e1']);
  });

  it('STUBS collapses onto |s regardless of hydrateParticipants — it has no sides to hydrate', async () => {
    // Three variants, not four. Minting `|s|n` would split a key for a distinction the payload cannot
    // express, doubling stub entries and halving their hit rate for nothing.
    await controller.eventData({ tournamentId: 't1', eventId: 'e1', drawsProfile: 'STUBS' } as any);
    await controller.eventData({
      tournamentId: 't1',
      eventId: 'e1',
      hydrateParticipants: false,
      drawsProfile: 'STUBS',
    } as any);

    expect(cache.set.mock.calls.map((c: any[]) => c[0])).toEqual(['ged|t1|e1|s', 'ged|t1|e1|s']);
  });

  it('DRAW tier: hydrateParticipants gets its own key and reaches the service', async () => {
    await controller.drawData({ tournamentId: 't1', drawId: 'd1' } as any);
    await controller.drawData({ tournamentId: 't1', drawId: 'd1', hydrateParticipants: false } as any);

    const setKeys = cache.set.mock.calls.map((c: any[]) => c[0]);
    expect(setKeys).toContain('gdd|t1|d1');
    expect(setKeys).toContain('gdd|t1|d1|n');

    const calls = (service.getDrawData as Mock).mock.calls;
    expect(calls[1][0].hydrateParticipants).toBe(false);
    // ADDITIVE: an omitted flag must not invent a value on the way through.
    expect(Object.keys(calls[0][0])).not.toContain('hydrateParticipants');
  });

  it('EVICTION: a stale thin payload is the fail-open direction, so both variants go', async () => {
    // invalidateTournamentCache spares a per-entity key only on an EXACT evicted.has(key) match, so
    // getMutationEngine.evictEventData emits both. If it ever stops, the thin payload is served
    // stale for the full TTL while the full one refreshes — silently, and only for stub callers.
    await controller.eventData({ tournamentId: 't1', eventId: 'e1' } as any);
    await controller.eventData({ tournamentId: 't1', eventId: 'e1', drawsProfile: 'STUBS' } as any);
    cache.del.mockClear();

    (service.executionQueue as Mock).mockResolvedValueOnce({
      evictedEventKeys: ['ged|t1|e1', 'ged|t1|e1|s'],
      tournamentIds: ['t1'],
      success: true,
    });
    const req = { provisioner: undefined, headers: {}, auditSource: undefined };
    await controller.executionQueue({ tournamentIds: ['t1'], methods: [] } as any, req);

    const deleted = cache.del.mock.calls.map((c: any[]) => c[0]);
    expect(deleted).toContain('ged|t1|e1');
    expect(deleted).toContain('ged|t1|e1|s');
  });

  it('ROSTER: a score-only mutation KEEPS the participant roster', async () => {
    // The point of the change. Today every mutation discards gtp|<tid>, so one point scored throws
    // away the roster and the next reader rebuilds a list that did not change. Measured against the
    // factory: completing matchUps changes 0 roster entries.
    await controller.tournamentParticipants({ params: { tournamentId: 't1' } } as any);
    cache.del.mockClear();

    (service.executionQueue as Mock).mockResolvedValueOnce({
      noticeTopics: [topicConstants.MODIFY_MATCHUP, topicConstants.MODIFY_POSITION_ASSIGNMENTS],
      tournamentIds: ['t1'],
      success: true,
    });
    await controller.executionQueue({ tournamentIds: ['t1'], methods: [] } as any, REQ);

    expect(cache.del.mock.calls.map((c: any[]) => c[0])).not.toContain('gtp|t1');
  });

  it('ROSTER: a participant mutation DISCARDS it', async () => {
    // The control for the test above. Without this, "not discarded" could mean the sweep never ran.
    await controller.tournamentParticipants({ params: { tournamentId: 't1' } } as any);
    cache.del.mockClear();

    (service.executionQueue as Mock).mockResolvedValueOnce({
      noticeTopics: [topicConstants.MODIFY_PARTICIPANTS],
      tournamentIds: ['t1'],
      success: true,
    });
    await controller.executionQueue({ tournamentIds: ['t1'], methods: [] } as any, REQ);

    expect(cache.del.mock.calls.map((c: any[]) => c[0])).toContain('gtp|t1');
  });

  it('ROSTER: ONE unsafe topic among safe ones is enough to discard it', async () => {
    // A mutation emits several topics. Sparing on "some were safe" would serve a stale roster
    // whenever a withdrawal rode along with a score — which is exactly when it matters.
    await controller.tournamentParticipants({ params: { tournamentId: 't1' } } as any);
    cache.del.mockClear();

    (service.executionQueue as Mock).mockResolvedValueOnce({
      noticeTopics: [topicConstants.MODIFY_MATCHUP, topicConstants.MODIFY_EVENT_ENTRIES],
      tournamentIds: ['t1'],
      success: true,
    });
    await controller.executionQueue({ tournamentIds: ['t1'], methods: [] } as any, REQ);

    expect(cache.del.mock.calls.map((c: any[]) => c[0])).toContain('gtp|t1');
  });

  it('ROSTER: NO topics means we know nothing, so it is discarded', async () => {
    // Silence must not read as "nothing happened".
    await controller.tournamentParticipants({ params: { tournamentId: 't1' } } as any);
    cache.del.mockClear();

    (service.executionQueue as Mock).mockResolvedValueOnce({
      tournamentIds: ['t1'],
      success: true,
    });
    await controller.executionQueue({ tournamentIds: ['t1'], methods: [] } as any, REQ);

    expect(cache.del.mock.calls.map((c: any[]) => c[0])).toContain('gtp|t1');
  });

  it('ROSTER: an UNKNOWN topic is treated as unsafe', async () => {
    // A topic added to the handler map but not to the allow-list must not be spared by accident.
    await controller.tournamentParticipants({ params: { tournamentId: 't1' } } as any);
    cache.del.mockClear();

    (service.executionQueue as Mock).mockResolvedValueOnce({
      noticeTopics: [topicConstants.MODIFY_MATCHUP, 'someTopicAddedLater'],
      tournamentIds: ['t1'],
      success: true,
    });
    await controller.executionQueue({ tournamentIds: ['t1'], methods: [] } as any, REQ);

    expect(cache.del.mock.calls.map((c: any[]) => c[0])).toContain('gtp|t1');
  });

  it('ROSTER: sparing it does not spare the other tournament-scoped keys', async () => {
    // gtp| is spared on its own merits; gtm| and the rest aggregate across entities and still go.
    await controller.tournamentParticipants({ params: { tournamentId: 't1' } } as any);
    await controller.tournamentMatchUps({ params: { tournamentId: 't1' } } as any);
    cache.del.mockClear();

    (service.executionQueue as Mock).mockResolvedValueOnce({
      noticeTopics: [topicConstants.MODIFY_MATCHUP],
      tournamentIds: ['t1'],
      success: true,
    });
    await controller.executionQueue({ tournamentIds: ['t1'], methods: [] } as any, REQ);

    const deleted = cache.del.mock.calls.map((c: any[]) => c[0]);
    expect(deleted).not.toContain('gtp|t1');
    expect(deleted).toContain('gtm|t1');
  });

  it('EVICTION: sparing is per-key, so an untouched event keeps BOTH of its variants', async () => {
    // The control for the test above: if narrowing did not work, this would pass trivially because
    // everything was swept. e2 must survive while e1 goes.
    await controller.eventData({ tournamentId: 't1', eventId: 'e1' } as any);
    await controller.eventData({ tournamentId: 't1', eventId: 'e1', drawsProfile: 'STUBS' } as any);
    await controller.eventData({ tournamentId: 't1', eventId: 'e2' } as any);
    await controller.eventData({ tournamentId: 't1', eventId: 'e2', drawsProfile: 'STUBS' } as any);
    cache.del.mockClear();

    (service.executionQueue as Mock).mockResolvedValueOnce({
      evictedEventKeys: ['ged|t1|e1', 'ged|t1|e1|s'],
      tournamentIds: ['t1'],
      success: true,
    });
    const req = { provisioner: undefined, headers: {}, auditSource: undefined };
    await controller.executionQueue({ tournamentIds: ['t1'], methods: [] } as any, req);

    const deleted = cache.del.mock.calls.map((c: any[]) => c[0]);
    expect(deleted).not.toContain('ged|t1|e2');
    expect(deleted).not.toContain('ged|t1|e2|s');
  });
});
