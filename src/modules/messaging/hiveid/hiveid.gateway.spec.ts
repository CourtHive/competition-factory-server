import { HiveIDGateway } from './hiveid.gateway';

describe('HiveIDGateway', () => {
  let gateway: HiveIDGateway;

  function fakeClient(user: any) {
    return {
      id: 'sock-1',
      data: { user },
      joinedRooms: [] as string[],
      join(room: string) {
        this.joinedRooms.push(room);
        return Promise.resolve();
      },
    };
  }

  beforeEach(() => {
    gateway = new HiveIDGateway();
  });

  describe('handleConnection', () => {
    it('joins the per-person room when the JWT carries a personId', async () => {
      const client: any = fakeClient({ email: 'jane@test.com', personId: 'p-1' });
      await gateway.handleConnection(client);
      expect(client.joinedRooms).toEqual(['hiveid:person:p-1']);
    });

    it('connects without joining a room when no personId is present', async () => {
      const client: any = fakeClient({ email: 'unlinked@test.com' });
      await gateway.handleConnection(client);
      expect(client.joinedRooms).toEqual([]);
    });

    it('tolerates a non-string personId', async () => {
      const client: any = fakeClient({ email: 'jane@test.com', personId: 123 });
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

  describe('broadcastPersonUpdate', () => {
    it('emits personUpdate to the person room', () => {
      const emit = jest.fn();
      const to = jest.fn().mockReturnValue({ emit });
      (gateway as any).server = { to };
      gateway.broadcastPersonUpdate('p-1', { type: 'refresh' });
      expect(to).toHaveBeenCalledWith('hiveid:person:p-1');
      expect(emit).toHaveBeenCalledWith('personUpdate', { type: 'refresh' });
    });

    it('no-ops on missing personId or payload', () => {
      const emit = jest.fn();
      const to = jest.fn().mockReturnValue({ emit });
      (gateway as any).server = { to };
      gateway.broadcastPersonUpdate('', { type: 'refresh' });
      gateway.broadcastPersonUpdate('p-1', undefined);
      expect(to).not.toHaveBeenCalled();
    });
  });
});
