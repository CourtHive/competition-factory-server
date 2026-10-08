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

  // Defect fixed 2026-10-08: executionQueue returns the methods it appended (a provider's privacy
  // policy on tournament creation) so TMX can replay them, but the ack was built as
  // `{ ackId, success }` and dropped them. TMX's replay branch (mutationRequest.ts) never ran.
  it('carries appliedServerMethods on a successful ack', async () => {
    const appliedServerMethods = [{ method: 'attachPolicies', params: { policyDefinitions: {} } }];
    vi.spyOn(executionQueueModule, 'executionQueue').mockResolvedValue({ success: true, appliedServerMethods });
    const { ack } = await run({ ackId: 'a1' });
    expect(ack.appliedServerMethods).toEqual(appliedServerMethods);
  });

  it('omits appliedServerMethods when the server appended none', async () => {
    vi.spyOn(executionQueueModule, 'executionQueue').mockResolvedValue({ success: true, appliedServerMethods: [] });
    const { ack } = await run({ ackId: 'a1' });
    expect(ack).toEqual({ ackId: 'a1', success: true });
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
