import { initRoomJoins, recordRoomJoin, SocketIoRealtimeAdapter } from './socket-io-realtime.adapter';
import { personChannel, tournamentChannel } from './channels';
import { Logger } from '@nestjs/common';

/** A Namespace double recording `to(room)[.except(id)].emit(event, payload)`. */
function makeNamespace(socketsByRoom: Record<string, any[]> = {}) {
  const emitted: Array<{ room: string; except?: string; event: string; payload: any }> = [];
  return {
    emitted,
    adapter: { rooms: new Map(Object.entries(socketsByRoom).map(([room, s]) => [room, new Set(s.map((x) => x.id))])) },
    in: (room: string) => ({ fetchSockets: async () => socketsByRoom[room] ?? [] }),
    to: (room: string) => {
      let except: string | undefined;
      const operator: any = {
        except: (id: string) => {
          except = id;
          return operator;
        },
        emit: (event: string, payload: any) => emitted.push({ room, except, event, payload }),
      };
      return operator;
    },
  };
}

describe('SocketIoRealtimeAdapter', () => {
  let adapter: SocketIoRealtimeAdapter;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    adapter = new SocketIoRealtimeAdapter();
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  describe('publish', () => {
    it('emits to the channel room in the bound namespace', () => {
      const nsp = makeNamespace();
      adapter.bind('tmx', nsp as any);

      expect(adapter.publish(tournamentChannel('t1'), 'tournamentMutation', { a: 1 })).toBe(true);
      expect(nsp.emitted).toEqual([
        { room: 'tournament:t1', except: undefined, event: 'tournamentMutation', payload: { a: 1 } },
      ]);
    });

    it('excludes the originating connection when asked', () => {
      const nsp = makeNamespace();
      adapter.bind('tmx', nsp as any);

      adapter.publish(tournamentChannel('t1'), 'chatMessage', {}, { excludeConnectionId: 'sock-9' });
      expect(nsp.emitted[0]).toMatchObject({ room: 'tournament:t1', except: 'sock-9' });
    });

    it('routes by namespace — a /hiveid channel never reaches the /tmx namespace', () => {
      const tmx = makeNamespace();
      const hiveid = makeNamespace();
      adapter.bind('tmx', tmx as any);
      adapter.bind('hiveid', hiveid as any);

      adapter.publish(personChannel('p-1'), 'personUpdate', {});
      expect(tmx.emitted).toHaveLength(0);
      expect(hiveid.emitted).toHaveLength(1);
    });

    // A2: a publish to an unbound namespace used to be a silent no-op in two of the three
    // broadcasters. It must be counted, logged at milestones, and followed by a recovery line.
    it('returns false and warns on the first drop to an unbound namespace', () => {
      expect(adapter.publish(tournamentChannel('t1'), 'tournamentMutation', {})).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('/tmx not bound');
      expect(warn.mock.calls[0][0]).toContain('(1x)');
    });

    it('throttles repeated drops to milestones', () => {
      for (let i = 0; i < 9; i++) adapter.publish(tournamentChannel('t1'), 'e', {});
      expect(warn).toHaveBeenCalledTimes(1);
      adapter.publish(tournamentChannel('t1'), 'e', {});
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls[1][0]).toContain('(10x)');
    });

    it('logs a recovery once the namespace is bound after drops', () => {
      adapter.publish(tournamentChannel('t1'), 'e', {});
      adapter.publish(tournamentChannel('t1'), 'e', {});
      adapter.bind('tmx', makeNamespace() as any);
      adapter.publish(tournamentChannel('t1'), 'e', {});
      expect(warn.mock.calls.at(-1)?.[0]).toContain('/tmx publishing again after 2 dropped event(s)');

      // ...and only once: the next healthy publish is quiet.
      const before = warn.mock.calls.length;
      adapter.publish(tournamentChannel('t1'), 'e', {});
      expect(warn.mock.calls.length).toBe(before);
    });
  });

  describe('presence', () => {
    const socket = (id: string, user?: any) => {
      const s: any = { id, data: { user } };
      initRoomJoins(s);
      return s;
    };

    it('reports members with their user and when they joined that room', async () => {
      const a = socket('sa', { email: 'a@x.com' });
      recordRoomJoin(a, 'tournament:t1');
      const nsp = makeNamespace({ 'tournament:t1': [a] });
      adapter.bind('tmx', nsp as any);

      const members = await adapter.members(tournamentChannel('t1'));
      expect(members).toEqual([{ connectionId: 'sa', user: { email: 'a@x.com' }, joinedAt: expect.any(Number) }]);
    });

    it('lists rooms by prefix', async () => {
      adapter.bind('tmx', makeNamespace({ 'tournament:t1': [], 'tournament:t2': [], 'admin:chatMonitor': [] }) as any);
      const rooms = await adapter.rooms('tmx', 'tournament:');
      expect(rooms.sort((x, y) => x.localeCompare(y))).toEqual(['tournament:t1', 'tournament:t2']);
    });

    it('is empty, not an error, for an unbound namespace', async () => {
      expect(await adapter.members(tournamentChannel('t1'))).toEqual([]);
      expect(await adapter.rooms('tmx', 'tournament:')).toEqual([]);
    });
  });
});
