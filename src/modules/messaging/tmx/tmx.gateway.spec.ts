import { Logger } from '@nestjs/common';
import { TmxGateway, TOURNAMENT_ROOM_PREFIX } from './tmx.gateway';

/**
 * Focused unit tests for TmxGateway.joinTournament and getActiveRoomPresence.
 * The gateway is wide; these tests exercise the lastAccess + presence surface
 * that backs the admin "Active Rooms" panel.
 */

interface MockSocket {
  id: string;
  data: any;
  rooms: Set<string>;
  join: jest.Mock;
  leave: jest.Mock;
  emit: jest.Mock;
  to: jest.Mock;
}

function makeSocket(overrides: Partial<{ id: string; user: any }> = {}): MockSocket {
  const s: any = {
    id: overrides.id ?? 'sock-1',
    data: { user: overrides.user, tournamentJoinedAt: {} },
    rooms: new Set(),
    handshake: { headers: {} },
    join: jest.fn(async (room: string) => { s.rooms.add(room); }),
    leave: jest.fn(async (room: string) => { s.rooms.delete(room); }),
    emit: jest.fn(),
    to: jest.fn().mockReturnValue({ emit: jest.fn() }),
  };
  return s as MockSocket;
}

function makeMockServer(socketsByRoom: Record<string, MockSocket[]>) {
  const adapterRooms = new Map<string, Set<string>>();
  for (const [room, sockets] of Object.entries(socketsByRoom)) {
    adapterRooms.set(room, new Set(sockets.map((s) => s.id)));
  }
  return {
    sockets: { adapter: { rooms: adapterRooms } },
    in: (room: string) => ({
      fetchSockets: async () => socketsByRoom[room] ?? [],
    }),
    to: jest.fn().mockReturnValue({ emit: jest.fn() }),
  } as any;
}

function buildGateway(opts: { userStorage?: any; providerStorage?: any } = {}) {
  const userStorage = opts.userStorage ?? { updateLastAccess: jest.fn().mockResolvedValue(undefined) };
  const providerStorage = opts.providerStorage ?? {
    updateLastAccess: jest.fn().mockResolvedValue(undefined),
    getProvider: jest.fn(),
    getProviders: jest.fn(),
    setProvider: jest.fn(),
    removeProvider: jest.fn(),
  };
  const tournamentStorageService: any = {
    fetchTournamentRecords: jest.fn().mockResolvedValue({ tournamentRecords: {} }),
  };
  const broadcastService: any = { setTmxServer: jest.fn(), broadcastMutation: jest.fn(), broadcastPublicNotices: jest.fn() };
  const assignmentsService: any = { getAssignedTournamentIds: jest.fn().mockResolvedValue([]) };
  const usersService: any = { findOne: jest.fn().mockResolvedValue(null) };
  const cacheManager: any = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
  const userProviderStorage: any = { findByEmail: jest.fn().mockResolvedValue([]) };

  const gateway = new TmxGateway(
    cacheManager,
    userProviderStorage,
    userStorage,
    providerStorage,
    tournamentStorageService,
    broadcastService,
    assignmentsService,
    usersService,
  );
  return { gateway, userStorage, providerStorage };
}

describe('TmxGateway.handleConnection', () => {
  it('records connectedAt and an empty per-tournament joinedAt map', () => {
    const { gateway } = buildGateway();
    const socket = makeSocket();
    socket.data = {};

    gateway.handleConnection(socket as any);

    expect(typeof socket.data.connectedAt).toBe('number');
    expect(socket.data.tournamentJoinedAt).toEqual({});
  });
});

describe('TmxGateway.joinTournament', () => {
  it('updates user + provider lastAccess for a JWT user', async () => {
    const { gateway, userStorage, providerStorage } = buildGateway();
    const socket = makeSocket({ user: { email: 'me@test.com', providerId: 'prov-1' } });
    gateway.server = makeMockServer({ [TOURNAMENT_ROOM_PREFIX + 't1']: [socket] });

    await gateway.joinTournament({ tournamentId: 't1' }, socket as any);
    await Promise.resolve();

    expect(socket.join).toHaveBeenCalledWith('tournament:t1');
    expect(userStorage.updateLastAccess).toHaveBeenCalledWith('me@test.com');
    expect(providerStorage.updateLastAccess).toHaveBeenCalledWith('prov-1');
    expect(socket.data.tournamentJoinedAt.t1).toEqual(expect.any(Number));
  });

  it('skips lastAccess update when socket is unauthenticated', async () => {
    const { gateway, userStorage, providerStorage } = buildGateway();
    const socket = makeSocket();
    gateway.server = makeMockServer({ [TOURNAMENT_ROOM_PREFIX + 't1']: [socket] });

    await gateway.joinTournament({ tournamentId: 't1' }, socket as any);
    await Promise.resolve();

    expect(userStorage.updateLastAccess).not.toHaveBeenCalled();
    expect(providerStorage.updateLastAccess).not.toHaveBeenCalled();
  });

  it('logs (but does not throw) when lastAccess update fails', async () => {
    const userStorage = { updateLastAccess: jest.fn().mockRejectedValue(new Error('db down')) };
    const providerStorage = {
      updateLastAccess: jest.fn().mockRejectedValue(new Error('db down')),
      getProvider: jest.fn(), getProviders: jest.fn(), setProvider: jest.fn(), removeProvider: jest.fn(),
    };
    const { gateway } = buildGateway({ userStorage, providerStorage });
    const socket = makeSocket({ user: { email: 'me@test.com', providerId: 'prov-1' } });
    gateway.server = makeMockServer({ [TOURNAMENT_ROOM_PREFIX + 't1']: [socket] });
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await gateway.joinTournament({ tournamentId: 't1' }, socket as any);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('rejects malformed input without touching lastAccess', async () => {
    const { gateway, userStorage } = buildGateway();
    const socket = makeSocket({ user: { email: 'me@test.com', providerId: 'prov-1' } });
    gateway.server = makeMockServer({});

    await gateway.joinTournament({} as any, socket as any);

    expect(socket.join).not.toHaveBeenCalled();
    expect(userStorage.updateLastAccess).not.toHaveBeenCalled();
  });
});

describe('TmxGateway.getActiveRoomPresence', () => {
  it('returns empty list when no tournament rooms exist', async () => {
    const { gateway } = buildGateway();
    gateway.server = makeMockServer({ 'admin:chatMonitor': [makeSocket()] });

    const presence = await gateway.getActiveRoomPresence();
    expect(presence).toEqual([]);
  });

  it('reports per-room counts and member identities', async () => {
    const { gateway } = buildGateway();
    const a = makeSocket({ id: 'sa', user: { email: 'a@x.com', providerId: 'p1', userId: 'ua' } });
    a.data.tournamentJoinedAt = { t1: 1700000000000 };
    const b = makeSocket({ id: 'sb', user: { email: 'b@x.com', providerId: 'p2', userId: 'ub' } });
    b.data.tournamentJoinedAt = { t1: 1700000000500 };
    const c = makeSocket({ id: 'sc' });
    gateway.server = makeMockServer({
      [TOURNAMENT_ROOM_PREFIX + 't1']: [a, b],
      [TOURNAMENT_ROOM_PREFIX + 't2']: [c],
    });

    const presence = await gateway.getActiveRoomPresence();
    expect(presence).toHaveLength(2);
    const t1 = presence.find((r) => r.tournamentId === 't1')!;
    expect(t1.count).toBe(2);
    expect(t1.members.map((m) => m.email).sort()).toEqual(['a@x.com', 'b@x.com']);
    expect(t1.members.find((m) => m.email === 'a@x.com')?.joinedAt).toBe(1700000000000);
    const t2 = presence.find((r) => r.tournamentId === 't2')!;
    expect(t2.count).toBe(1);
    expect(t2.members[0].email).toBeUndefined();
  });
});
