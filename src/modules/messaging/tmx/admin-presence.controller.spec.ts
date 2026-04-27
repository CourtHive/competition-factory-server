import { AdminPresenceController } from './admin-presence.controller';

describe('AdminPresenceController', () => {
  function build(opts: { rooms: any[]; providers?: Record<string, any> } = { rooms: [] }) {
    const tmxGateway: any = {
      getActiveRoomPresence: jest.fn().mockResolvedValue(opts.rooms),
    };
    const providerStorage: any = {
      getProvider: jest.fn(async (id: string) => opts.providers?.[id] ?? null),
      getProviders: jest.fn(),
      setProvider: jest.fn(),
      removeProvider: jest.fn(),
      updateLastAccess: jest.fn(),
    };
    const controller = new AdminPresenceController(tmxGateway, providerStorage);
    return { controller, tmxGateway, providerStorage };
  }

  it('returns an empty snapshot when no rooms exist', async () => {
    const { controller } = build({ rooms: [] });
    const result = await controller.list();
    expect(result.totalSockets).toBe(0);
    expect(result.rooms).toEqual([]);
    expect(typeof result.takenAt).toBe('number');
  });

  it('enriches members with provider name + abbreviation', async () => {
    const rooms = [
      {
        tournamentId: 't1',
        count: 2,
        members: [
          { socketId: 'sa', email: 'a@x.com', providerId: 'p1', userId: 'ua', joinedAt: 1700000000000 },
          { socketId: 'sb', email: 'b@x.com', providerId: 'p2', userId: 'ub', joinedAt: 1700000000500 },
        ],
      },
    ];
    const providers = {
      p1: { organisationName: 'One Org', organisationAbbreviation: 'ONE' },
      p2: { organisationName: 'Two Org', organisationAbbreviation: 'TWO' },
    };
    const { controller, providerStorage } = build({ rooms, providers });

    const result = await controller.list();

    expect(result.totalSockets).toBe(2);
    expect(result.rooms).toHaveLength(1);
    const room = result.rooms[0];
    const a = room.members.find((m) => m.email === 'a@x.com')!;
    expect(a.providerName).toBe('One Org');
    expect(a.providerAbbreviation).toBe('ONE');
    expect(a.joinedAt).toBe(1700000000000);
    // 2 distinct providers — only 2 lookups, even though there could be more sockets
    expect(providerStorage.getProvider).toHaveBeenCalledTimes(2);
  });

  it('passes through members with no providerId without crashing', async () => {
    const rooms = [{ tournamentId: 't1', count: 1, members: [{ socketId: 'sa' }] }];
    const { controller, providerStorage } = build({ rooms });

    const result = await controller.list();

    expect(result.rooms[0].members[0].providerName).toBeUndefined();
    expect(providerStorage.getProvider).not.toHaveBeenCalled();
  });

  it('survives provider lookup failures (best-effort enrichment)', async () => {
    const rooms = [{ tournamentId: 't1', count: 1, members: [{ socketId: 'sa', providerId: 'gone' }] }];
    const tmxGateway: any = { getActiveRoomPresence: jest.fn().mockResolvedValue(rooms) };
    const providerStorage: any = { getProvider: jest.fn().mockRejectedValue(new Error('db down')) };
    const controller = new AdminPresenceController(tmxGateway, providerStorage);

    const result = await controller.list();
    expect(result.rooms[0].members[0].providerId).toBe('gone');
    expect(result.rooms[0].members[0].providerName).toBeUndefined();
  });
});
