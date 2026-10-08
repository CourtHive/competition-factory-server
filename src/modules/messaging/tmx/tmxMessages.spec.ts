import * as executionQueueModule from 'src/modules/factory/functions/private/executionQueue';
import { tmxMessages } from './tmxMessages';
import { Logger } from '@nestjs/common';

describe('tmxMessages.executionQueue', () => {
  const run = (payload: any) => tmxMessages.executionQueue({ payload, services: {}, storage: {} as any });

  afterEach(() => vi.restoreAllMocks());

  it('returns the ack instead of sending it — the handler holds no transport', async () => {
    vi.spyOn(executionQueueModule, 'executionQueue').mockResolvedValue({
      success: true,
      publicNotices: [{ topic: 't' }],
    });
    const result = await run({ ackId: 'a1' });
    expect(result).toEqual({ ack: { ackId: 'a1', success: true }, publicNotices: [{ topic: 't' }] });
  });

  // P49: the sender's own sync point — when its mutation's rows were written.
  it('carries serverUpdatedAt on a successful ack', async () => {
    const serverUpdatedAt = { t1: '2026-10-08T19:30:00.123Z' };
    const previousServerUpdatedAt = { t1: '2026-10-08T19:29:00.000Z' };
    vi.spyOn(executionQueueModule, 'executionQueue').mockResolvedValue({
      success: true,
      serverUpdatedAt,
      previousServerUpdatedAt,
    });
    const { ack } = await run({ ackId: 'a1' });
    expect(ack).toEqual({ ackId: 'a1', success: true, serverUpdatedAt, previousServerUpdatedAt });
  });

  it('returns the error detail on a failed mutation', async () => {
    vi.spyOn(executionQueueModule, 'executionQueue').mockResolvedValue({
      error: { message: 'nope' },
      context: { c: 1 },
      tournamentIds: ['t1'],
    });
    const { ack } = await run({ ackId: 'a1' });
    expect(ack).toEqual({ ackId: 'a1', error: { message: 'nope' }, context: { c: 1 }, tournamentIds: ['t1'] });
  });

  it('returns a server-error ack when executionQueue throws', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(executionQueueModule, 'executionQueue').mockRejectedValue(new Error('kaboom'));
    const result = await run({ ackId: 'a1', tournamentIds: ['t1'] });
    expect(result).toEqual({ ack: { ackId: 'a1', error: 'Server error', tournamentIds: ['t1'] } });
  });
});
