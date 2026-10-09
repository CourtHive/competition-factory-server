import { SocketIoRealtimeAdapter } from '../realtime/socket-io-realtime.adapter';
import { TournamentChatService } from './tournament-chat.service';
import { TOURNAMENT_ROOM_PREFIX } from '../realtime/channels';
import type { Mock } from 'vitest';
import { TmxGateway } from './tmx.gateway';
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
  join: Mock;
  leave: Mock;
  emit: Mock;
  on: Mock;
  to: Mock;
}

function makeSocket(overrides: Partial<{ id: string; user: any }> = {}): MockSocket {
  const s: any = {
    id: overrides.id ?? 'sock-1',
    data: { user: overrides.user, roomJoinedAt: {} },
    rooms: new Set(),
    handshake: { headers: {} },
    join: vi.fn(async (room: string) => {
      s.rooms.add(room);
    }),
    leave: vi.fn(async (room: string) => {
      s.rooms.delete(room);
    }),
    emit: vi.fn(),
    on: vi.fn(),
    to: vi.fn().mockReturnValue({ emit: vi.fn() }),
  };
  return s as MockSocket;
}

interface Emitted {
  room: string;
  except?: string;
  event: string;
  payload: any;
}

function makeMockServer(socketsByRoom: Record<string, MockSocket[]>) {
  const adapterRooms = new Map<string, Set<string>>();
  for (const [room, sockets] of Object.entries(socketsByRoom)) {
    adapterRooms.set(room, new Set(sockets.map((s) => s.id)));
  }
  // Every `to(room)[.except(id)].emit(event, payload)` lands here, so a test
  // can assert the room, the excluded sender, the event and the payload.
  const emitted: Emitted[] = [];
  return {
    // Namespace shape — the gateway is registered to `namespace: 'tmx'`,
    // so the adapter is on the namespace itself, not nested under `.sockets`.
    adapter: { rooms: adapterRooms },
    in: (room: string) => ({
      fetchSockets: async () => socketsByRoom[room] ?? [],
    }),
    to: vi.fn((room: string) => {
      let excluded: string | undefined;
      const operator: any = {
        except: vi.fn((id: string) => {
          excluded = id;
          return operator;
        }),
        emit: vi.fn((event: string, payload: any) => emitted.push({ room, except: excluded, event, payload })),
      };
      return operator;
    }),
    emitted,
  } as any;
}

/** Bind a mock namespace the way Nest does: set the property, then run afterInit. */
function attachServer(gateway: TmxGateway, server: any) {
  gateway.server = server;
  gateway.afterInit(server);
  return server;
}

function buildGateway(opts: { userStorage?: any; providerStorage?: any } = {}) {
  const userStorage = opts.userStorage ?? { updateLastAccess: vi.fn().mockResolvedValue(undefined) };
  const providerStorage = opts.providerStorage ?? {
    updateLastAccess: vi.fn().mockResolvedValue(undefined),
    updateLastAccessByTournament: vi.fn().mockResolvedValue(undefined),
    getProvider: vi.fn(),
    getProviders: vi.fn(),
    setProvider: vi.fn(),
    removeProvider: vi.fn(),
  };
  const tournamentStorageService: any = {
    fetchTournamentRecords: vi.fn().mockResolvedValue({ tournamentRecords: {} }),
  };
  const assignmentsService: any = {
    getAssignedTournamentIds: vi.fn().mockResolvedValue(new Set()),
    getAssignedRoles: vi.fn().mockResolvedValue(new Map()),
  };
  const usersService: any = { findOne: vi.fn().mockResolvedValue(null) };
  const cacheManager: any = { get: vi.fn(), set: vi.fn(), del: vi.fn() };
  const userProviderStorage: any = { findByEmail: vi.fn().mockResolvedValue([]) };
  const userProvisionerStorage: any = { findProvisionerIdsByUser: vi.fn().mockResolvedValue([]) };
  const provisionerProviderStorage: any = { findByProvisioner: vi.fn().mockResolvedValue([]) };
  const chatStorage: any = {
    appendMessage: vi.fn().mockResolvedValue({
      record: {
        seq: 1,
        tournamentId: 't',
        userName: 'u',
        message: 'm',
        isAdmin: false,
        createdAt: new Date(0).toISOString(),
      },
    }),
    recentMessages: vi.fn().mockResolvedValue({ records: [] }),
    messagesSince: vi.fn().mockResolvedValue({ records: [] }),
    adminMessagesBefore: vi.fn().mockResolvedValue({ records: [] }),
    pruneOlderThan: vi.fn().mockResolvedValue({ deleted: 0 }),
  };

  // One adapter for the gateway and the chat service, as in production (RealtimeModule binds both
  // to the same instance).
  const realtime = new SocketIoRealtimeAdapter();
  const gateway = new TmxGateway(
    cacheManager,
    userProviderStorage,
    userProvisionerStorage,
    provisionerProviderStorage,
    userStorage,
    providerStorage,
    chatStorage,
    tournamentStorageService,
    assignmentsService,
    usersService,
    realtime,
    new TournamentChatService(chatStorage, realtime, tournamentStorageService, assignmentsService),
  );
  return { gateway, userStorage, providerStorage, chatStorage };
}

describe('TmxGateway chat persistence', () => {
  it('persists a chatMessage, relays it with seq, and acks the sender', async () => {
    const { gateway, chatStorage } = buildGateway();
    chatStorage.appendMessage.mockResolvedValue({
      record: {
        seq: 42,
        tournamentId: 't1',
        userName: 'u',
        message: 'hi',
        isAdmin: false,
        clientMsgId: 'c1',
        createdAt: new Date(1000).toISOString(),
      },
    });
    const socket = makeSocket();
    const server = attachServer(gateway, makeMockServer({}));

    await gateway.chatMessage({ tournamentId: 't1', userName: 'u', message: 'hi', clientMsgId: 'c1' }, socket as any);

    expect(chatStorage.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ tournamentId: 't1', message: 'hi', clientMsgId: 'c1' }),
    );
    // Relayed to the room (sender excluded) with the persisted seq.
    expect(server.emitted).toContainEqual({
      room: 'tournament:t1',
      except: 'sock-1',
      event: 'chatMessage',
      payload: expect.objectContaining({ seq: 42, message: 'hi' }),
    });
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
      records: [
        {
          seq: 1,
          tournamentId: 't1',
          userName: 'a',
          message: 'm1',
          isAdmin: false,
          createdAt: new Date(0).toISOString(),
        },
      ],
    });
    const socket = makeSocket({ user: { email: 'me@test.com' } });
    attachServer(gateway, makeMockServer({ [TOURNAMENT_ROOM_PREFIX + 't1']: [socket] }));

    await gateway.joinTournament({ tournamentId: 't1' }, socket as any);

    expect(chatStorage.recentMessages).toHaveBeenCalledWith({ tournamentId: 't1' });
    expect(socket.emit).toHaveBeenCalledWith(
      'chatHistory',
      expect.objectContaining({ tournamentId: 't1', messages: expect.any(Array) }),
    );
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
      records: [
        {
          seq: 7,
          tournamentId: 't9',
          providerId: 'p',
          providerAbbr: 'ACME',
          tournamentName: 'Open',
          userName: 'x',
          message: 'hey',
          isAdmin: false,
          createdAt: new Date(0).toISOString(),
        },
      ],
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
      records: [
        {
          seq: 3,
          tournamentId: 't9',
          providerAbbr: 'ACME',
          tournamentName: 'Open',
          userName: 'x',
          message: 'older',
          isAdmin: false,
          createdAt: new Date(0).toISOString(),
        },
      ],
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
  it('records connectedAt and an empty per-room joinedAt map', () => {
    const { gateway } = buildGateway();
    const socket = makeSocket();
    socket.data = {};

    gateway.handleConnection(socket as any);

    expect(typeof socket.data.connectedAt).toBe('number');
    expect(socket.data.roomJoinedAt).toEqual({});
  });
});

describe('TmxGateway.joinTournament', () => {
  it('updates user lastAccess + tournament-driven provider lastAccess for a JWT user', async () => {
    const { gateway, userStorage, providerStorage } = buildGateway();
    const socket = makeSocket({ user: { email: 'me@test.com', providerId: 'prov-1' } });
    attachServer(gateway, makeMockServer({ [TOURNAMENT_ROOM_PREFIX + 't1']: [socket] }));

    await gateway.joinTournament({ tournamentId: 't1' }, socket as any);
    await Promise.resolve();

    expect(socket.join).toHaveBeenCalledWith('tournament:t1');
    expect(userStorage.updateLastAccess).toHaveBeenCalledWith('me@test.com');
    // Provider update is keyed off the tournament's owning provider, not the
    // user's home providerId — covers multi-provider users / switcher flows.
    expect(providerStorage.updateLastAccessByTournament).toHaveBeenCalledWith('t1');
    expect(providerStorage.updateLastAccess).not.toHaveBeenCalled();
    expect(socket.data.roomJoinedAt['tournament:t1']).toEqual(expect.any(Number));
  });

  it('skips provider lastAccess update for super-admins', async () => {
    const { gateway, userStorage, providerStorage } = buildGateway();
    const socket = makeSocket({ user: { email: 'admin@test.com', providerId: 'prov-1', roles: ['superadmin'] } });
    attachServer(gateway, makeMockServer({ [TOURNAMENT_ROOM_PREFIX + 't1']: [socket] }));

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
    attachServer(gateway, makeMockServer({ [TOURNAMENT_ROOM_PREFIX + 't1']: [socket] }));

    await gateway.joinTournament({ tournamentId: 't1' }, socket as any);
    await Promise.resolve();

    expect(userStorage.updateLastAccess).not.toHaveBeenCalled();
    expect(providerStorage.updateLastAccessByTournament).not.toHaveBeenCalled();
  });

  it('logs (but does not throw) when lastAccess update fails', async () => {
    const userStorage = { updateLastAccess: vi.fn().mockRejectedValue(new Error('db down')) };
    const providerStorage = {
      updateLastAccess: vi.fn(),
      updateLastAccessByTournament: vi.fn().mockRejectedValue(new Error('db down')),
      getProvider: vi.fn(),
      getProviders: vi.fn(),
      setProvider: vi.fn(),
      removeProvider: vi.fn(),
    };
    const { gateway } = buildGateway({ userStorage, providerStorage });
    const socket = makeSocket({ user: { email: 'me@test.com', providerId: 'prov-1' } });
    attachServer(gateway, makeMockServer({ [TOURNAMENT_ROOM_PREFIX + 't1']: [socket] }));
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

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
    attachServer(gateway, makeMockServer({}));

    await gateway.joinTournament({} as any, socket as any);

    expect(socket.join).not.toHaveBeenCalled();
    expect(userStorage.updateLastAccess).not.toHaveBeenCalled();
  });
});

describe('TmxGateway.getActiveRoomPresence', () => {
  it('returns empty list when no tournament rooms exist', async () => {
    const { gateway } = buildGateway();
    attachServer(gateway, makeMockServer({ 'admin:chatMonitor': [makeSocket()] }));

    const presence = await gateway.getActiveRoomPresence();
    expect(presence).toEqual([]);
  });

  it('reports per-room counts and member identities', async () => {
    const { gateway } = buildGateway();
    const a = makeSocket({ id: 'sa', user: { email: 'a@x.com', providerId: 'p1', userId: 'ua' } });
    a.data.roomJoinedAt = { 'tournament:t1': 1700000000000 };
    const b = makeSocket({ id: 'sb', user: { email: 'b@x.com', providerId: 'p2', userId: 'ub' } });
    b.data.roomJoinedAt = { 'tournament:t1': 1700000000500 };
    const c = makeSocket({ id: 'sc' });
    attachServer(
      gateway,
      makeMockServer({
        [TOURNAMENT_ROOM_PREFIX + 't1']: [a, b],
        [TOURNAMENT_ROOM_PREFIX + 't2']: [c],
      }),
    );

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

describe('TmxGateway room presence', () => {
  it('publishes roomPresence to the tournament room after a join', async () => {
    const { gateway } = buildGateway();
    const socket = makeSocket({ user: { email: 'a@x.com' } });
    const server = attachServer(gateway, makeMockServer({ [TOURNAMENT_ROOM_PREFIX + 't1']: [socket] }));

    await gateway.joinTournament({ tournamentId: 't1' }, socket as any);

    expect(server.emitted).toContainEqual({
      room: 'tournament:t1',
      except: undefined,
      event: 'roomPresence',
      payload: { tournamentId: 't1', count: 1 },
    });
  });
});

describe('TmxGateway room leave and admin replies', () => {
  it('leaveTournament leaves the room and publishes the new count to it', async () => {
    const { gateway } = buildGateway();
    const socket = makeSocket({ user: { email: 'a@x.com' } });
    const server = attachServer(gateway, makeMockServer({ [TOURNAMENT_ROOM_PREFIX + 't1']: [] }));

    await gateway.leaveTournament({ tournamentId: 't1' }, socket as any);

    expect(socket.leave).toHaveBeenCalledWith('tournament:t1');
    expect(server.emitted).toContainEqual({
      room: 'tournament:t1',
      except: undefined,
      event: 'roomPresence',
      payload: { tournamentId: 't1', count: 0 },
    });
  });

  it('leaveTournament ignores a malformed tournamentId', async () => {
    const { gateway } = buildGateway();
    const socket = makeSocket();
    const server = attachServer(gateway, makeMockServer({}));

    await gateway.leaveTournament({} as any, socket as any);

    expect(socket.leave).not.toHaveBeenCalled();
    expect(server.emitted).toHaveLength(0);
  });

  it('adminChatReply publishes to the whole room (sender included) and to the monitor feed', async () => {
    const { gateway, chatStorage } = buildGateway();
    chatStorage.appendMessage.mockResolvedValue({
      record: {
        seq: 9,
        tournamentId: 't1',
        userName: 'Admin',
        message: 'hello',
        isAdmin: true,
        createdAt: new Date(0).toISOString(),
      },
    });
    const socket = makeSocket({ user: { email: 'admin@x.com', roles: ['superadmin'] } });
    const server = attachServer(gateway, makeMockServer({}));

    await gateway.adminChatReply({ tournamentId: 't1', message: 'hello' }, socket as any);

    expect(server.emitted).toContainEqual({
      room: 'tournament:t1',
      except: undefined,
      event: 'chatMessage',
      payload: expect.objectContaining({ seq: 9, message: 'hello', isAdmin: true }),
    });
    expect(server.emitted).toContainEqual({
      room: 'admin:chatMonitor',
      except: undefined,
      event: 'adminChatFeed',
      payload: expect.objectContaining({ seq: 9, tournamentId: 't1' }),
    });
  });

  it('adminChatReply still relays when persisting fails, with the identity it was given', async () => {
    const { gateway, chatStorage } = buildGateway();
    chatStorage.appendMessage.mockResolvedValue({ error: 'db down' });
    const socket = makeSocket({ user: { email: 'admin@x.com', roles: ['superadmin'] } });
    const server = attachServer(gateway, makeMockServer({}));

    await gateway.adminChatReply(
      { tournamentId: 't1', message: 'hi', providerId: 'p1', providerAbbr: 'ACME', tournamentName: 'Open' },
      socket as any,
    );

    expect(server.emitted).toContainEqual(
      expect.objectContaining({
        room: 'tournament:t1',
        event: 'chatMessage',
        payload: expect.objectContaining({ message: 'hi' }),
      }),
    );
    expect(server.emitted).toContainEqual(
      expect.objectContaining({
        room: 'admin:chatMonitor',
        event: 'adminChatFeed',
        payload: expect.objectContaining({ tournamentId: 't1', providerAbbr: 'ACME', tournamentName: 'Open' }),
      }),
    );
  });
});
