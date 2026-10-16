import { commandFingerprint, saveFingerprint } from 'src/storage/postgres/commandReceipts';
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
