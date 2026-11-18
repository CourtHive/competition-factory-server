import { commandFingerprint, saveFingerprint } from 'src/storage/postgres/commandReceipts';
import { scoreCommand } from './functions/private/setMatchUpStatus';
import { FactoryController } from './factory.controller';

function fixture() {
  const service: any = { executionQueue: vi.fn(async () => ({ success: true, publicNotices: [] })) };
  const broadcast: any = { broadcastMutation: vi.fn(), broadcastPublicNotices: vi.fn() };
  const gate: any = { gate: vi.fn(async () => undefined) };
  const cache: any = { del: vi.fn(), get: vi.fn(), set: vi.fn() };
  const controller = new FactoryController(service, broadcast, gate, {} as any, cache);
  const req = { user: { userId: 'verified-actor', email: 'td@example.com' } };
  const body = () => ({
    commandId: 'stable-command',
    commandUser: req.user.email,
    tournamentIds: ['t1'],
    methods: [{ method: 'setTournamentName', params: { tournamentName: 'Open' } }],
  });
  return { service, broadcast, gate, controller, req, body };
}
describe('durable command HTTP boundary', () => {
  it('overwrites client-asserted receipt identity and hashes before attribution stamping', async () => {
    const f = fixture();
    const body: any = { ...f.body(), commandActor: 'spoofed', commandFingerprint: 'spoofed' };
    const expected = commandFingerprint(body);
    await f.controller.executionQueue(body, f.req);
    const payload = f.service.executionQueue.mock.calls[0][0];
    expect(payload.commandActor).toBe('verified-actor');
    expect(payload.commandFingerprint).toBe(expected);
  });
  it('authorizes retries but does not broadcast an already applied command again', async () => {
    const f = fixture();
    f.service.executionQueue.mockResolvedValue({ success: true, deduplicated: true });
    await f.controller.executionQueue(f.body(), f.req);
    expect(f.gate.gate).toHaveBeenCalledTimes(1);
    expect(f.broadcast.broadcastMutation).not.toHaveBeenCalled();
    expect(f.broadcast.broadcastPublicNotices).not.toHaveBeenCalled();
  });
  it('does not send a queued command using another account token', async () => {
    const f = fixture();
    await expect(
      f.controller.executionQueue(f.body(), { user: { userId: 'other', email: 'other@example.com' } }),
    ).rejects.toThrow('another user');
    expect(f.service.executionQueue).not.toHaveBeenCalled();
  });
  it('does not bypass a changed authorization gate just because a command ID exists', async () => {
    const f = fixture();
    f.gate.gate.mockResolvedValue('Permission revoked');
    await expect(f.controller.executionQueue(f.body(), f.req)).rejects.toThrow('Permission revoked');
    expect(f.service.executionQueue).not.toHaveBeenCalled();
  });
});
describe('durable score HTTP boundary', () => {
  const scoreBody = () => ({
    commandId: 'stable-score',
    commandUser: 'td@example.com',
    params: { tournamentId: 't1', drawId: 'd1', matchUpId: 'm1', outcome: { winningSide: 1 } },
  });
  const scoreFixture = () => {
    const f = fixture();
    f.service.score = vi.fn(async () => ({ success: true, publicNotices: [] }));
    return f;
  };
  it('stamps the verified actor and the server-computed intent over any the client asserted', async () => {
    const f = scoreFixture();
    const body: any = { ...scoreBody(), commandActor: 'spoofed', commandFingerprint: 'spoofed' };
    await f.controller.scoreMatchUp(body, f.req);
    const payload = f.service.score.mock.calls[0][0];
    expect(payload.commandId).toBe('stable-score');
    expect(payload.commandActor).toBe('verified-actor');
    expect(payload.commandFingerprint).toBe(commandFingerprint(scoreCommand(scoreBody())));
  });
  it('hashes the score, not the transport: a flat resend with another ackId has the same intent', async () => {
    // Flat, not the { params } wrapper: here the transport fields sit beside the score fields.
    const f = scoreFixture();
    const { params, ...command } = scoreBody();
    await f.controller.scoreMatchUp({ ...command, ...params, ackId: 'a1' } as any, f.req);
    await f.controller.scoreMatchUp({ ...command, ...params, ackId: 'a2' } as any, f.req);
    const [first, second] = f.service.score.mock.calls.map((call) => call[0].commandFingerprint);
    expect(first).toBe(second);
    expect(scoreCommand(f.service.score.mock.calls[0][0]).methods[0].params).toEqual({
      drawId: 'd1',
      matchUpId: 'm1',
      outcome: { winningSide: 1 },
    });
  });
  it('does not send a queued score using another account token', async () => {
    const f = scoreFixture();
    await expect(
      f.controller.scoreMatchUp(scoreBody() as any, { user: { userId: 'other', email: 'other@example.com' } }),
    ).rejects.toThrow('another user');
    expect(f.service.score).not.toHaveBeenCalled();
  });
  it('does not broadcast a score its receipt already answered', async () => {
    const f = scoreFixture();
    f.service.score.mockResolvedValue({ success: true, deduplicated: true });
    await f.controller.scoreMatchUp(scoreBody() as any, f.req);
    expect(f.broadcast.broadcastMutation).not.toHaveBeenCalled();
  });
  it('leaves a score without a commandId non-durable, whatever command fields the client sent', async () => {
    const f = scoreFixture();
    const body = { ...scoreBody(), commandId: undefined, commandActor: 'spoofed', commandFingerprint: 'spoofed' };
    await f.controller.scoreMatchUp(body as any, f.req);
    const payload = f.service.score.mock.calls[0][0];
    expect(payload.commandId).toBeUndefined();
    expect(payload.commandActor).toBeUndefined();
    expect(payload.commandFingerprint).toBeUndefined();
  });
});
describe('durable wholesale save HTTP boundary', () => {
  it('stamps the verified actor and the server-computed intent over any the client asserted', async () => {
    const f = fixture();
    f.service.saveTournamentRecords = vi.fn(async () => ({ success: true }));
    const body: any = {
      commandId: 'stable-save',
      tournamentRecord: { tournamentId: 't1' },
      expectedServerUpdatedAt: { t1: null },
      commandActor: 'spoofed',
      commandFingerprint: 'spoofed',
    };
    const expected = saveFingerprint(body);
    await f.controller.saveTournamentRecords(body, f.req.user);
    const payload = f.service.saveTournamentRecords.mock.calls[0][0];
    expect(payload.commandActor).toBe('verified-actor');
    expect(payload.commandFingerprint).toBe(expected);
  });
  it('leaves a save without a commandId exactly as sent', async () => {
    const f = fixture();
    f.service.saveTournamentRecords = vi.fn(async () => ({ success: true }));
    const body: any = { tournamentRecord: { tournamentId: 't1' } };
    await f.controller.saveTournamentRecords(body, f.req.user);
    expect(f.service.saveTournamentRecords.mock.calls[0][0]).toBe(body);
  });
});
