import { TournamentBroadcastService } from '../messaging/broadcast/tournament-broadcast.service';
import { FactoryController } from './factory.controller';
import { FactoryService } from './factory.service';

import type { UserContext } from '../account/auth/decorators/user-context.decorator';

/**
 * The public tournament-info routes withhold an UNPUBLISHED tournament from anyone who could not fetch it
 * through the authenticated routes, and serve an anonymous caller only the published view (punch list P1,
 * P23 D7).
 *
 * The cache here is a real Map rather than a no-op, because the property that matters most is that a
 * payload cached for an entitled caller is never served to an unentitled one.
 */

const MISSING = 'Tournament not found';

const PUBLISHED = {
  success: true,
  tournamentInfo: { tournamentId: 't1', publishState: { status: { published: true } } },
};
const UNPUBLISHED = {
  success: true,
  tournamentInfo: { tournamentId: 't1', publishState: { status: { published: false } } },
};

const adminContext = {
  userId: 'u1',
  providerIds: ['P1'],
  providerRoles: { P1: 'PROVIDER_ADMIN' },
} as unknown as UserContext;

function build(serviceResult: any, canRead = false) {
  const store = new Map<string, any>();
  const cache = {
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: any) => store.set(key, value)),
    del: vi.fn(async (key: string) => store.delete(key)),
  };
  const service = {
    getTournamentInfo: vi.fn().mockImplementation(async () => structuredClone(serviceResult)),
    canReadUnpublishedTournament: vi.fn().mockResolvedValue(canRead),
  } as unknown as FactoryService;
  const broadcast = {
    broadcastMutation: vi.fn(),
    broadcastPublicNotices: vi.fn(),
  } as unknown as TournamentBroadcastService;
  const controller = new FactoryController(
    service,
    broadcast,
    { gate: vi.fn().mockResolvedValue(null) } as any,
    { forCaller: vi.fn().mockResolvedValue([]) } as any,
    cache as any,
  );
  return { controller, service: service as any };
}

describe('public tournament info — the publish gate', () => {
  it('serves a PUBLISHED tournament to an anonymous caller without an access check', async () => {
    const { controller, service } = build(PUBLISHED);

    const result: any = await controller.tournamentInfo({ tournamentId: 't1' });

    expect(result.tournamentInfo.tournamentId).toEqual('t1');
    expect(service.canReadUnpublishedTournament).not.toHaveBeenCalled();
  });

  it('withholds an UNPUBLISHED tournament from an anonymous caller, on both routes', async () => {
    const { controller } = build(UNPUBLISHED);

    expect(await controller.tournamentInfo({ tournamentId: 't1' })).toEqual({ error: MISSING });
    expect(await controller.getTournamentInfo('t1')).toEqual({ error: MISSING });
  });

  it('answers a withheld tournament exactly as a tournament that does not exist', async () => {
    const { controller: withheld } = build(UNPUBLISHED);
    const { controller: absent } = build({ error: MISSING });

    const hidden = await withheld.tournamentInfo({ tournamentId: 't1' });
    const missing = await absent.tournamentInfo({ tournamentId: 't1' });

    expect(missing).toEqual({ error: MISSING });
    expect(hidden).toEqual(missing);
  });

  it('serves an UNPUBLISHED tournament to a caller who could fetch it', async () => {
    const { controller, service } = build(UNPUBLISHED, true);

    const result: any = await controller.tournamentInfo({ tournamentId: 't1' }, undefined, adminContext);

    expect(result.tournamentInfo.tournamentId).toEqual('t1');
    expect(service.canReadUnpublishedTournament).toHaveBeenCalledWith('t1', undefined, adminContext);
  });

  it('withholds an UNPUBLISHED tournament from an identified caller who could not fetch it', async () => {
    const { controller } = build(UNPUBLISHED, false);

    expect(await controller.tournamentInfo({ tournamentId: 't1' }, undefined, adminContext)).toEqual({
      error: MISSING,
    });
  });

  it('never serves a payload cached for an entitled caller to an anonymous one', async () => {
    const { controller, service } = build(UNPUBLISHED, true);

    // the entitled read fills the cache for this exact key
    const entitled: any = await controller.getTournamentInfo('t1', undefined, adminContext);
    expect(entitled.tournamentInfo.tournamentId).toEqual('t1');

    service.canReadUnpublishedTournament.mockResolvedValue(false);
    const anonymous: any = await controller.getTournamentInfo('t1');

    expect(anonymous).toEqual({ error: MISSING });
    // control: the second read really was a cache hit, so the gate — not a fresh miss — withheld it
    expect(service.getTournamentInfo).toHaveBeenCalledTimes(1);
  });

  it('passes errors through untouched', async () => {
    const { controller, service } = build({ error: 'MISSING_TOURNAMENT_ID' });

    expect(await controller.tournamentInfo({ tournamentId: '' })).toEqual({ error: 'MISSING_TOURNAMENT_ID' });
    expect(service.canReadUnpublishedTournament).not.toHaveBeenCalled();
  });
});

describe('public tournament info — who chooses usePublishState', () => {
  it('forces the published view on an anonymous caller who asks for the unfiltered one', async () => {
    const { controller, service } = build(PUBLISHED);

    await controller.tournamentInfo({ tournamentId: 't1', usePublishState: false, withMatchUpStats: true });

    expect(service.getTournamentInfo).toHaveBeenCalledWith({
      tournamentId: 't1',
      usePublishState: true,
      withMatchUpStats: true,
    });
  });

  it('forces it on a caller with a player token but no admin-audience context', async () => {
    const { controller, service } = build(PUBLISHED);
    const hiveIdUser = { userId: 'player-1', email: 'player@example.com' };

    await controller.tournamentInfo({ tournamentId: 't1', usePublishState: false }, hiveIdUser);

    expect(service.getTournamentInfo).toHaveBeenCalledWith({ tournamentId: 't1', usePublishState: true });
  });

  it('leaves the choice to a caller with an admin-audience context', async () => {
    const { controller, service } = build(PUBLISHED);

    await controller.tournamentInfo({ tournamentId: 't1', usePublishState: false }, undefined, adminContext);

    expect(service.getTournamentInfo).toHaveBeenCalledWith({ tournamentId: 't1', usePublishState: false });
  });
});

describe('FactoryService.canReadUnpublishedTournament', () => {
  const call = (self: any, ...args: any[]) =>
    (FactoryService.prototype.canReadUnpublishedTournament as any).call(self, ...args);

  it('is false with no identity at all, without consulting storage', async () => {
    const self = { fetchTournamentUpdatedAt: vi.fn() };
    expect(await call(self, 't1', undefined, undefined)).toBe(false);
    expect(self.fetchTournamentUpdatedAt).not.toHaveBeenCalled();
  });

  it('follows the authenticated fetch gates exactly', async () => {
    const allowed = { fetchTournamentUpdatedAt: vi.fn().mockResolvedValue({ success: true, updatedAt: 'x' }) };
    const refused = { fetchTournamentUpdatedAt: vi.fn().mockResolvedValue({ error: 'User not allowed' }) };

    expect(await call(allowed, 't1', undefined, adminContext)).toBe(true);
    expect(await call(refused, 't1', undefined, adminContext)).toBe(false);
    expect(allowed.fetchTournamentUpdatedAt).toHaveBeenCalledWith({ tournamentId: 't1' }, undefined, adminContext);
  });
});
