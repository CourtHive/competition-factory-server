import { SocketIoRealtimeAdapter } from '../realtime/socket-io-realtime.adapter';
import { HiveIDGateway } from './hiveid.gateway';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';

describe('HiveIDGateway', () => {
  const jwt = new JwtService({ secret: 'hiveid-spec-secret' });
  let gateway: HiveIDGateway;

  function fakeClient(user: any, token?: string) {
    return {
      id: 'sock-1',
      data: { user },
      handshake: { auth: token ? { token } : {}, headers: {} },
      joinedRooms: [] as string[],
      join(room: string) {
        this.joinedRooms.push(room);
        return Promise.resolve();
      },
    };
  }

  /** A client that has only connected: no guard has run, so nothing is on `data` yet. */
  function connectingClient(claims: Record<string, any>) {
    return fakeClient(undefined, jwt.sign(claims));
  }

  beforeEach(() => {
    gateway = new HiveIDGateway(jwt, new SocketIoRealtimeAdapter());
  });

  describe('handleConnection', () => {
    it('joins the per-person room when the JWT carries a personId', async () => {
      const client: any = connectingClient({ email: 'jane@test.com', personId: 'p-1', aud: 'hiveid' });
      await gateway.handleConnection(client);
      expect(client.joinedRooms).toEqual(['hiveid:person:p-1']);
    });

    it('connects without joining a room when no personId is present', async () => {
      const client: any = connectingClient({ email: 'unlinked@test.com', aud: 'hiveid' });
      await gateway.handleConnection(client);
      expect(client.joinedRooms).toEqual([]);
    });

    it('tolerates a non-string personId', async () => {
      const client: any = connectingClient({ email: 'jane@test.com', personId: 123, aud: 'hiveid' });
      await gateway.handleConnection(client);
      expect(client.joinedRooms).toEqual([]);
    });

    // The defect this pins: SocketGuard never runs before handleConnection, so the gateway must
    // authenticate the handshake itself. These clients carry NOTHING on `data` — only a token.
    it('stamps the verified user on the connection, where the guard would have put it', async () => {
      const client: any = connectingClient({ email: 'jane@test.com', personId: 'p-1', aud: 'hiveid' });
      await gateway.handleConnection(client);
      expect(client.data.user).toEqual(expect.objectContaining({ email: 'jane@test.com', personId: 'p-1' }));
    });

    it('does not join for a token without the hiveid audience', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const client: any = connectingClient({ email: 'admin@test.com', personId: 'p-1', aud: 'admin' });
      await gateway.handleConnection(client);
      warn.mockRestore();
      expect(client.joinedRooms).toEqual([]);
      expect(client.data.user).toBeUndefined();
    });

    it('does not join for a token signed with another secret', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const forged = new JwtService({ secret: 'not-the-secret' }).sign({ personId: 'p-1', aud: 'hiveid' });
      const client: any = fakeClient(undefined, forged);
      await gateway.handleConnection(client);
      warn.mockRestore();
      expect(client.joinedRooms).toEqual([]);
      expect(client.data.user).toBeUndefined();
    });

    it('does not join when the handshake carries no token', async () => {
      const client: any = fakeClient(undefined);
      await gateway.handleConnection(client);
      expect(client.joinedRooms).toEqual([]);
    });
  });

  describe('subscribePerson', () => {
    it('joins the JWT-attested person room (no cross-person subscribe)', async () => {
      const client: any = fakeClient({ email: 'jane@test.com', personId: 'p-1' });
      const result = await gateway.subscribePerson(client);
      expect(result).toEqual({ ok: true, personId: 'p-1' });
      expect(client.joinedRooms).toEqual(['hiveid:person:p-1']);
    });

    it('returns { ok: false } when the token has no personId', async () => {
      const client: any = fakeClient({ email: 'unlinked@test.com' });
      const result = await gateway.subscribePerson(client);
      expect(result).toEqual({ ok: false });
      expect(client.joinedRooms).toEqual([]);
    });
  });
});
