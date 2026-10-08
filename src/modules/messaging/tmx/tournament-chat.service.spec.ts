import { TournamentChatService } from './tournament-chat.service';
import { TmxChatController } from './tmx-chat.controller';

const record = (over: Record<string, any> = {}) => ({
  seq: 7,
  tournamentId: 't1',
  userName: 'desk@example.com',
  message: 'hi',
  clientMsgId: 'c1',
  isAdmin: false,
  createdAt: new Date(1000).toISOString(),
  ...over,
});

function build({ tournament }: { tournament?: any } = {}) {
  const chatStorage: any = {
    appendMessage: vi.fn(async (row: any) => ({ record: record({ userName: row.userName }) })),
  };
  const publisher: any = { publish: vi.fn(() => true) };
  const storage: any = {
    fetchTournamentRecords: vi.fn(async () => ({ tournamentRecords: tournament ? { t1: tournament } : {} })),
  };
  const assignments: any = { getAssignedTournamentIds: vi.fn(async () => new Set()) };
  const service = new TournamentChatService(chatStorage, publisher, storage, assignments);
  return { service, chatStorage, publisher };
}

const outsider: any = {
  userId: 'u-out',
  email: 'out@x.com',
  isSuperAdmin: false,
  globalRoles: ['client'],
  providerRoles: { 'other-provider': 'DIRECTOR' },
  providerIds: ['other-provider'],
};
const verifiedUser = { email: 'desk@example.com', userId: 'u-1' };
const input = { tournamentId: 't1', message: 'hi', clientMsgId: 'c1', userName: 'someone-else@x.com' };

describe('TournamentChatService', () => {
  const scoping = process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING;
  afterEach(() => {
    process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING = scoping;
  });

  it('persists, relays to the room excluding the sending connection, feeds the monitor, and accepts', async () => {
    const { service, publisher } = build();
    const result = await service.send(input, { verifiedUser, excludeConnectionId: 'sock-1' });

    expect(result).toEqual({ accepted: { clientMsgId: 'c1', seq: 7, timestamp: 1000 } });
    const [channel, event, , options] = publisher.publish.mock.calls[0];
    expect([channel.room, event, options]).toEqual(['tournament:t1', 'chatMessage', { excludeConnectionId: 'sock-1' }]);
    expect(publisher.publish.mock.calls[1][1]).toBe('adminChatFeed');
  });

  it('relays to everyone when there is no connection to exclude (HTTP)', async () => {
    const { service, publisher } = build();
    await service.send(input, { verifiedUser });
    expect(publisher.publish.mock.calls[0][3]).toEqual({ excludeConnectionId: undefined });
  });

  it('records the author the token names, not the one the client sent', async () => {
    const { service, chatStorage } = build();
    await service.send(input, { verifiedUser });
    expect(chatStorage.appendMessage.mock.calls[0][0].userName).toBe('desk@example.com');
  });

  // Defect: the socket handler gated a chat post by the CLIENT role alone, so a caller who could
  // not join a tournament's room could still write into its chat.
  it('refuses a caller who cannot view the tournament, and stores and relays nothing', async () => {
    process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING = 'true';
    const { service, chatStorage, publisher } = build({
      tournament: { tournamentId: 't1', parentOrganisation: { organisationId: 'owner-provider' } },
    });
    const result = await service.send(input, { verifiedUser, userContext: outsider });

    expect(result).toEqual({ rejected: { clientMsgId: 'c1', error: 'Not authorized to view this tournament' } });
    expect(chatStorage.appendMessage).not.toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('rejects when the message could not be stored', async () => {
    const { service, chatStorage, publisher } = build();
    chatStorage.appendMessage.mockResolvedValueOnce({ error: 'db down' });
    expect(await service.send(input, { verifiedUser })).toEqual({ rejected: { clientMsgId: 'c1', error: 'db down' } });
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('ignores an empty message or a missing tournament', async () => {
    const { service, chatStorage } = build();
    expect(await service.send({ ...input, message: '   ' }, { verifiedUser })).toEqual({ ignored: true });
    expect(await service.send({ ...input, tournamentId: undefined }, { verifiedUser })).toEqual({ ignored: true });
    expect(chatStorage.appendMessage).not.toHaveBeenCalled();
  });
});

describe('TmxChatController (POST /tmx/chat)', () => {
  it('sends as the authenticated caller, with no connection to exclude, and answers with the result', async () => {
    const chat: any = { send: vi.fn(async () => ({ accepted: { clientMsgId: 'c1', seq: 1, timestamp: 2 } })) };
    const controller = new TmxChatController(chat);
    const userContext: any = { userId: 'u-1' };

    const result = await controller.send(input as any, { user: verifiedUser }, userContext);

    expect(chat.send).toHaveBeenCalledWith(input, { userContext, verifiedUser });
    expect(result).toEqual({ accepted: { clientMsgId: 'c1', seq: 1, timestamp: 2 } });
  });
});
