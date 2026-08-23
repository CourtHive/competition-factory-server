import { MutationAuthorizationService } from 'src/modules/factory/mutation-authorization.service';
import { MutationServicesService } from 'src/modules/mutation-services/mutation-services.service';
import { TmxGateway, TOURNAMENT_ROOM_PREFIX } from './tmx.gateway';
import { tmxMessages } from './tmxMessages';
import { Logger } from '@nestjs/common';

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
    // Namespace shape — the gateway is registered to `namespace: 'tmx'`,
    // so the adapter is on the namespace itself, not nested under `.sockets`.
    adapter: { rooms: adapterRooms },
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
    updateLastAccessByTournament: jest.fn().mockResolvedValue(undefined),
    getProvider: jest.fn(),
    getProviders: jest.fn(),
    setProvider: jest.fn(),
    removeProvider: jest.fn(),
  };
  const tournamentStorageService: any = {
    fetchTournamentRecords: jest.fn().mockResolvedValue({ tournamentRecords: {} }),
  };
  const broadcastService: any = { setTmxServer: jest.fn(), broadcastMutation: jest.fn(), broadcastPublicNotices: jest.fn() };
  const assignmentsService: any = {
    getAssignedTournamentIds: jest.fn().mockResolvedValue(new Set()),
    getAssignedRoles: jest.fn().mockResolvedValue(new Map()),
  };
  const usersService: any = { findOne: jest.fn().mockResolvedValue(null) };
  const cacheManager: any = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
  const userProviderStorage: any = { findByEmail: jest.fn().mockResolvedValue([]) };
  const userProvisionerStorage: any = { findProvisionerIdsByUser: jest.fn().mockResolvedValue([]) };
  const provisionerProviderStorage: any = { findByProvisioner: jest.fn().mockResolvedValue([]) };
  const auditService: any = { recordMutation: jest.fn().mockResolvedValue(undefined) };
  const chatStorage: any = {
    appendMessage: jest.fn().mockResolvedValue({
      record: { seq: 1, tournamentId: 't', userName: 'u', message: 'm', isAdmin: false, createdAt: new Date(0).toISOString() },
    }),
    recentMessages: jest.fn().mockResolvedValue({ records: [] }),
    messagesSince: jest.fn().mockResolvedValue({ records: [] }),
    adminMessagesBefore: jest.fn().mockResolvedValue({ records: [] }),
    pruneOlderThan: jest.fn().mockResolvedValue({ deleted: 0 }),
  };

  const gateway = new TmxGateway(
    cacheManager,
    userProviderStorage,
    userProvisionerStorage,
    provisionerProviderStorage,
    userStorage,
    providerStorage,
    chatStorage,
    tournamentStorageService,
    // Real builder over disabled collaborators — mirrors the production shape
    // (A1) so the gateway is exercised against the same bag it will receive in
    // prod, rather than against a stub that could drift from it.
    new MutationServicesService({ isEnabled: false, enqueue: jest.fn() } as any, {
      record: jest.fn(),
      isEnabled: false,
    } as any),
    broadcastService,
    assignmentsService,
    // Real gate over the same mocks — mirrors the production shape (A1) so the
    // gateway is exercised against the authorization path it actually uses.
    new MutationAuthorizationService(providerStorage, tournamentStorageService, assignmentsService),
    usersService,
    auditService,
  );
  return { gateway, userStorage, providerStorage, auditService, chatStorage };
}

describe('TmxGateway chat persistence', () => {
  it('persists a chatMessage, relays it with seq, and acks the sender', async () => {
    const { gateway, chatStorage } = buildGateway();
    chatStorage.appendMessage.mockResolvedValue({
      record: { seq: 42, tournamentId: 't1', userName: 'u', message: 'hi', isAdmin: false, clientMsgId: 'c1', createdAt: new Date(1000).toISOString() },
    });
    const socket = makeSocket();
    const relay = { emit: jest.fn() };
    socket.to.mockReturnValue(relay);
    gateway.server = makeMockServer({});

    await gateway.chatMessage({ tournamentId: 't1', userName: 'u', message: 'hi', clientMsgId: 'c1' }, socket as any);

    expect(chatStorage.appendMessage).toHaveBeenCalledWith(expect.objectContaining({ tournamentId: 't1', message: 'hi', clientMsgId: 'c1' }));
    // Relayed to the room (sender excluded) with the persisted seq.
    expect(socket.to).toHaveBeenCalledWith('tournament:t1');
    expect(relay.emit).toHaveBeenCalledWith('chatMessage', expect.objectContaining({ seq: 42, message: 'hi' }));
    // Sender gets the authoritative seq to reconcile its optimistic copy.
    expect(socket.emit).toHaveBeenCalledWith('chatAccepted', expect.objectContaining({ clientMsgId: 'c1', seq: 42 }));
  });

  it('drops an empty message without persisting', async () => {
    const { gateway, chatStorage } = buildGateway();
    const socket = makeSocket();
    await gateway.chatMessage({ tournamentId: 't1', userName: 'u', message: '   ' }, socket as any);
    expect(chatStorage.appendMessage).not.toHaveBeenCalled();
  });

  it('rejects to the sender when persistence fails', async () => {
    const { gateway, chatStorage } = buildGateway();
    chatStorage.appendMessage.mockResolvedValue({ error: 'db down' });
    const socket = makeSocket();
    await gateway.chatMessage({ tournamentId: 't1', userName: 'u', message: 'hi', clientMsgId: 'c9' }, socket as any);
    expect(socket.emit).toHaveBeenCalledWith('chatRejected', expect.objectContaining({ clientMsgId: 'c9' }));
  });

  it('backfills chat history to the joining socket', async () => {
    const { gateway, chatStorage } = buildGateway();
    chatStorage.recentMessages.mockResolvedValue({
      records: [{ seq: 1, tournamentId: 't1', userName: 'a', message: 'm1', isAdmin: false, createdAt: new Date(0).toISOString() }],
    });
    const socket = makeSocket({ user: { email: 'me@test.com' } });
    gateway.server = makeMockServer({ [TOURNAMENT_ROOM_PREFIX + 't1']: [socket] });

    await gateway.joinTournament({ tournamentId: 't1' }, socket as any);

    expect(chatStorage.recentMessages).toHaveBeenCalledWith({ tournamentId: 't1' });
    expect(socket.emit).toHaveBeenCalledWith('chatHistory', expect.objectContaining({ tournamentId: 't1', messages: expect.any(Array) }));
  });

  it('chatSince only answers when the socket is in the tournament room', async () => {
    const { gateway, chatStorage } = buildGateway();
    const socket = makeSocket();

    // Not in the room → ignored.
    await gateway.chatSince({ tournamentId: 't1', afterSeq: 5 }, socket as any);
    expect(chatStorage.messagesSince).not.toHaveBeenCalled();

    // In the room → answered with a gap-flagged chatHistory.
    socket.rooms.add('tournament:t1');
    chatStorage.messagesSince.mockResolvedValue({ records: [] });
    await gateway.chatSince({ tournamentId: 't1', afterSeq: 5 }, socket as any);
    expect(chatStorage.messagesSince).toHaveBeenCalledWith({ tournamentId: 't1', afterSeq: 5 });
    expect(socket.emit).toHaveBeenCalledWith('chatHistory', expect.objectContaining({ gap: true }));
  });

  it('backfills the most-recent cross-tournament page when an admin joins the monitor', async () => {
    const { gateway, chatStorage } = buildGateway();
    chatStorage.adminMessagesBefore.mockResolvedValue({
      records: [{ seq: 7, tournamentId: 't9', providerId: 'p', providerAbbr: 'ACME', tournamentName: 'Open', userName: 'x', message: 'hey', isAdmin: false, createdAt: new Date(0).toISOString() }],
    });
    const socket = makeSocket({ user: { email: 'admin@test.com', roles: ['superadmin'] } });

    await gateway.joinChatMonitor(socket as any);

    // Opens with the most-recent page (no beforeSeq), flagged as not-older.
    expect(chatStorage.adminMessagesBefore).toHaveBeenCalledWith({});
    expect(socket.emit).toHaveBeenCalledWith(
      'adminChatHistory',
      expect.objectContaining({
        older: false,
        messages: [expect.objectContaining({ seq: 7, providerAbbr: 'ACME', tournamentName: 'Open' })],
      }),
    );
  });

  it('pages older cross-tournament history on adminChatLoadOlder (older: true)', async () => {
    const { gateway, chatStorage } = buildGateway();
    chatStorage.adminMessagesBefore.mockResolvedValue({
      records: [{ seq: 3, tournamentId: 't9', providerAbbr: 'ACME', tournamentName: 'Open', userName: 'x', message: 'older', isAdmin: false, createdAt: new Date(0).toISOString() }],
    });
    const socket = makeSocket({ user: { email: 'admin@test.com', roles: ['superadmin'] } });
    socket.rooms.add('admin:chatMonitor');

    await gateway.adminChatLoadOlder({ beforeSeq: 7 }, socket as any);

    expect(chatStorage.adminMessagesBefore).toHaveBeenCalledWith({ beforeSeq: 7 });
    expect(socket.emit).toHaveBeenCalledWith(
      'adminChatHistory',
      expect.objectContaining({ older: true, messages: [expect.objectContaining({ seq: 3 })] }),
    );
  });

  it('ignores adminChatLoadOlder when the socket is not in the monitor room', async () => {
    const { gateway, chatStorage } = buildGateway();
    const socket = makeSocket({ user: { email: 'admin@test.com', roles: ['superadmin'] } });

    await gateway.adminChatLoadOlder({ beforeSeq: 7 }, socket as any);

    expect(chatStorage.adminMessagesBefore).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });
});

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
  it('updates user lastAccess + tournament-driven provider lastAccess for a JWT user', async () => {
    const { gateway, userStorage, providerStorage } = buildGateway();
    const socket = makeSocket({ user: { email: 'me@test.com', providerId: 'prov-1' } });
    gateway.server = makeMockServer({ [TOURNAMENT_ROOM_PREFIX + 't1']: [socket] });

    await gateway.joinTournament({ tournamentId: 't1' }, socket as any);
    await Promise.resolve();

    expect(socket.join).toHaveBeenCalledWith('tournament:t1');
    expect(userStorage.updateLastAccess).toHaveBeenCalledWith('me@test.com');
    // Provider update is keyed off the tournament's owning provider, not the
    // user's home providerId — covers multi-provider users / switcher flows.
    expect(providerStorage.updateLastAccessByTournament).toHaveBeenCalledWith('t1');
    expect(providerStorage.updateLastAccess).not.toHaveBeenCalled();
    expect(socket.data.tournamentJoinedAt.t1).toEqual(expect.any(Number));
  });

  it('skips provider lastAccess update for super-admins', async () => {
    const { gateway, userStorage, providerStorage } = buildGateway();
    const socket = makeSocket({ user: { email: 'admin@test.com', providerId: 'prov-1', roles: ['superadmin'] } });
    gateway.server = makeMockServer({ [TOURNAMENT_ROOM_PREFIX + 't1']: [socket] });

    await gateway.joinTournament({ tournamentId: 't1' }, socket as any);
    await Promise.resolve();

    // Per-user activity still tracked; provider activity is not credited
    // because super-admin operates across every provider.
    expect(userStorage.updateLastAccess).toHaveBeenCalledWith('admin@test.com');
    expect(providerStorage.updateLastAccessByTournament).not.toHaveBeenCalled();
  });

  it('skips lastAccess update when socket is unauthenticated', async () => {
    const { gateway, userStorage, providerStorage } = buildGateway();
    const socket = makeSocket();
    gateway.server = makeMockServer({ [TOURNAMENT_ROOM_PREFIX + 't1']: [socket] });

    await gateway.joinTournament({ tournamentId: 't1' }, socket as any);
    await Promise.resolve();

    expect(userStorage.updateLastAccess).not.toHaveBeenCalled();
    expect(providerStorage.updateLastAccessByTournament).not.toHaveBeenCalled();
  });

  it('logs (but does not throw) when lastAccess update fails', async () => {
    const userStorage = { updateLastAccess: jest.fn().mockRejectedValue(new Error('db down')) };
    const providerStorage = {
      updateLastAccess: jest.fn(),
      updateLastAccessByTournament: jest.fn().mockRejectedValue(new Error('db down')),
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

describe('TmxGateway executionQueue identity stamping', () => {
  let spy: jest.SpyInstance;
  afterEach(() => spy?.mockRestore());

  // Empty tournamentIds makes gatePerTournament pass unconditionally, so these
  // exercise the identity-stamping block in isolation. The captured payload is
  // what messageHandler forwards to the downstream executionQueue handler.
  async function capturePayload(user: any, payload: any) {
    const { gateway } = buildGateway();
    spy = jest.spyOn(tmxMessages, 'executionQueue').mockResolvedValue({} as any);
    const socket = makeSocket({ user });
    gateway.server = makeMockServer({});
    await gateway.messageHandler({ type: 'executionQueue', payload }, socket as any);
    return spy.mock.calls[0][0].payload;
  }

  it('overrides the client-supplied userId with the JWT-verified UUID', async () => {
    const passed = await capturePayload(
      { email: 'a@x.com', sub: 'verified-uuid' },
      { userId: 'client-spoofed', userEmail: 'evil@x.com', methods: [], tournamentIds: [] },
    );
    expect(passed.userId).toBe('verified-uuid');
    expect(passed.userEmail).toBe('a@x.com');
  });

  it('nulls userId when the verified token is email-only, never trusting the client value', async () => {
    const passed = await capturePayload(
      { email: 'a@x.com' }, // no userId/sub claim
      { userId: 'client-spoofed', methods: [], tournamentIds: [] },
    );
    expect(passed.userId).toBeNull();
    expect(passed.userEmail).toBe('a@x.com');
  });
});
