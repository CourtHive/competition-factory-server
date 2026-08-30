import { TournamentBroadcastService } from './tournament-broadcast.service';
import { ProjectorService } from 'src/modules/projectors/projector.service';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { PublicGateway } from '../public/public.gateway';
import type { Mock } from 'vitest';

/**
 * facilityScheduleChanged fan-out — the event-driven reserved-cell liveness path.
 *
 * When a source tournament's schedule (or link graph) changes, its stored linked peers' rooms get an
 * OPAQUE `facilityScheduleChanged` so coordinating clients re-fetch their reserved-cell projection.
 * Flag-gated (default off), debounced per source, fire-and-forget. Mirrors the construction shape of
 * tournament-broadcast.service.spec.ts (standard A1).
 */
describe('TournamentBroadcastService — facilityScheduleChanged fan-out', () => {
  const FLAG = 'ENABLE_FACILITY_SCHEDULE_BROADCAST';
  let originalFlag: string | undefined;

  let publicGateway: { broadcastPublicUpdate: Mock; broadcastLiveScore: Mock };
  let projectorService: { projectMatchUpFinalized: Mock };
  let storage: { fetchTournamentRecords: Mock };
  let emitCalls: Array<{ room: string; event: string; data: any }>;
  let mockServer: any;

  const records: Record<string, any> = {};

  function buildService(): TournamentBroadcastService {
    const service = new TournamentBroadcastService(
      publicGateway as unknown as PublicGateway,
      projectorService as unknown as ProjectorService,
      storage as unknown as TournamentStorageService,
    );
    service.setTmxServer(mockServer);
    return service;
  }

  function facilityEmits(): Array<{ room: string; data: any }> {
    return emitCalls.filter((c) => c.event === 'facilityScheduleChanged').map((c) => ({ room: c.room, data: c.data }));
  }

  beforeEach(() => {
    originalFlag = process.env[FLAG];
    process.env[FLAG] = 'true';
    vi.useFakeTimers();

    publicGateway = { broadcastPublicUpdate: vi.fn(), broadcastLiveScore: vi.fn() };
    projectorService = { projectMatchUpFinalized: vi.fn() };
    storage = {
      fetchTournamentRecords: vi.fn(async ({ tournamentId }: any) => ({
        tournamentRecords: { [tournamentId]: records[tournamentId] },
      })),
    };
    emitCalls = [];
    mockServer = {
      to: vi.fn((room: string) => ({ emit: (event: string, data: any) => emitCalls.push({ room, event, data }) })),
      in: vi.fn(() => ({ fetchSockets: vi.fn().mockResolvedValue([]) })),
    };

    for (const key of Object.keys(records)) delete records[key];
    records['ctx'] = { tournamentId: 'ctx', linkedTournamentIds: ['ctx', 'peer'], venues: [{ venueId: 'v1' }] };
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    if (originalFlag === undefined) delete process.env[FLAG];
    else process.env[FLAG] = originalFlag;
  });

  const scheduleMutation = (tournamentId = 'ctx') => ({
    tournamentIds: [tournamentId],
    methods: [{ method: 'addMatchUpScheduleItems', params: { schedule: { venueId: 'v1' } } }],
    userId: 'u1',
  });

  it('emits an opaque facilityScheduleChanged to the source’s linked peer rooms after the debounce', async () => {
    const service = buildService();
    await service.broadcastMutation(scheduleMutation());

    expect(facilityEmits()).toHaveLength(0); // not until the debounce fires
    await vi.runOnlyPendingTimersAsync();

    const emits = facilityEmits();
    expect(emits).toHaveLength(1);
    expect(emits[0].room).toBe('tournament:peer');
    expect(emits[0].data.venueIds).toEqual(['v1']);
    expect(typeof emits[0].data.changedAt).toBe('number');
    // Opaque: no matchUp/participant/source detail leaks.
    expect(emits[0].data.sourceTournamentId).toBeUndefined();
    expect(emits[0].data.methods).toBeUndefined();
  });

  it('does not fan out for a non-schedule mutation', async () => {
    const service = buildService();
    await service.broadcastMutation({
      tournamentIds: ['ctx'],
      methods: [{ method: 'setMatchUpStatus', params: { matchUpId: 'm1' } }],
    });
    await vi.runOnlyPendingTimersAsync();

    expect(facilityEmits()).toHaveLength(0);
    expect(storage.fetchTournamentRecords).not.toHaveBeenCalled();
  });

  it('collapses a burst into a single fan-out per source (debounce)', async () => {
    const service = buildService();
    await service.broadcastMutation(scheduleMutation());
    await service.broadcastMutation(scheduleMutation());
    await service.broadcastMutation(scheduleMutation());
    await vi.runOnlyPendingTimersAsync();

    expect(storage.fetchTournamentRecords).toHaveBeenCalledTimes(1);
    expect(facilityEmits()).toHaveLength(1);
  });

  it('does not fire before the 500ms debounce window elapses (negative tick)', async () => {
    const service = buildService();
    await service.broadcastMutation(scheduleMutation());

    await vi.advanceTimersByTimeAsync(499);
    expect(facilityEmits()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(facilityEmits()).toHaveLength(1);
  });

  it('does not fan out when the feature flag is off', async () => {
    process.env[FLAG] = 'false';
    const service = buildService(); // reads the flag at construction
    await service.broadcastMutation(scheduleMutation());
    await vi.runOnlyPendingTimersAsync();

    expect(facilityEmits()).toHaveLength(0);
  });

  it('treats unlink as schedule-affecting and reaches the vanished peer via the batch group', async () => {
    // After an unlink both records drop the link, so the removed peer is no longer in
    // linkedTournamentIds — it must be reached through the batch's other tournamentIds.
    records['ctx'] = { tournamentId: 'ctx', linkedTournamentIds: ['ctx'], venues: [{ venueId: 'v1' }] };
    records['gone'] = { tournamentId: 'gone', linkedTournamentIds: ['gone'], venues: [{ venueId: 'v9' }] };
    const service = buildService();
    await service.broadcastMutation({
      tournamentIds: ['ctx', 'gone'],
      methods: [{ method: 'unlinkTournaments', params: {} }],
    });
    await vi.runOnlyPendingTimersAsync();

    const rooms = facilityEmits().map((e) => e.room).sort();
    expect(rooms).toEqual(['tournament:ctx', 'tournament:gone']);
  });

  it('does not emit when the source has no linked peers', async () => {
    records['ctx'] = { tournamentId: 'ctx', linkedTournamentIds: ['ctx'], venues: [{ venueId: 'v1' }] };
    const service = buildService();
    await service.broadcastMutation(scheduleMutation());
    await vi.runOnlyPendingTimersAsync();

    expect(facilityEmits()).toHaveLength(0);
  });

  it('falls back to the source record’s venues when params carry none', async () => {
    const service = buildService();
    await service.broadcastMutation({
      tournamentIds: ['ctx'],
      methods: [{ method: 'proAutoSchedule', params: {} }], // schedule-affecting, no venueId
    });
    await vi.runOnlyPendingTimersAsync();

    const emits = facilityEmits();
    expect(emits).toHaveLength(1);
    expect(emits[0].data.venueIds).toEqual(['v1']); // from records['ctx'].venues
  });
});
