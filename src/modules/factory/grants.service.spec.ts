import { GrantsService } from './grants.service';

function build(rows: any[] | Error) {
  const grantStorage: any = {
    findForSubject:
      rows instanceof Error ? jest.fn().mockRejectedValue(rows) : jest.fn().mockResolvedValue(rows),
  };
  return { service: new GrantsService(grantStorage), grantStorage };
}

const ctx: any = { userId: 'u1' };

describe('GrantsService.forCaller', () => {
  it('returns the caller live grants in client shape', async () => {
    const { service } = build([
      { grantId: 'g1', userId: 'u1', capability: 'canEnterScores', scope: { courtIds: ['c7'] } },
    ]);
    const grants = await service.forCaller('t1', ctx);
    expect(grants).toEqual([
      { capability: 'canEnterScores', scope: { courtIds: ['c7'] }, notBefore: undefined, notAfter: undefined },
    ]);
  });

  // The client must not re-implement the window check — that would be a second
  // place for it to drift from the gate.
  it('filters out expired and not-yet-live grants rather than shipping their windows', async () => {
    const { service } = build([
      { capability: 'canEnterScores', scope: {}, notAfter: '2000-01-01T00:00:00Z' },
      { capability: 'canModifySchedule', scope: {}, notBefore: '2999-01-01T00:00:00Z' },
      { capability: 'canPublish', scope: {} },
    ]);
    const grants = await service.forCaller('t1', ctx);
    expect(grants.map((g) => g.capability)).toEqual(['canPublish']);
  });

  it('returns nothing without a user context or tournament', async () => {
    const { service, grantStorage } = build([]);
    expect(await service.forCaller('t1', undefined)).toEqual([]);
    expect(await service.forCaller('', ctx)).toEqual([]);
    expect(grantStorage.findForSubject).not.toHaveBeenCalled();
  });

  // Empty is "unrestricted by this mechanism", matching what the gate concludes.
  it('returns empty when storage is unavailable rather than implying a lockdown', async () => {
    const { service } = build(new Error('relation "tournament_grants" does not exist'));
    expect(await service.forCaller('t1', ctx)).toEqual([]);
  });
});
