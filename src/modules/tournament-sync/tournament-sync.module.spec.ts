import { TournamentExportController } from './tournament-export.controller';
import { TournamentSyncController } from './tournament-sync.controller';
import { MutationMirrorService } from './mutation-mirror.service';
import { TournamentSyncService } from './tournament-sync.service';
import { TournamentSyncModule } from './tournament-sync.module';

/**
 * Registration matrix for `TournamentSyncModule.forRoot()`.
 *
 * This is the guard on the 2026-08-15 role-default inversion. The module decides
 * what to register from `process.env` at construction time, which means the
 * decision is invisible to every other test in the suite — nothing else in CFS
 * boots the module under a varied environment.
 *
 * The specific regressions being locked out:
 *
 *   1. An instance that never sets `INSTANCE_ROLE` (production, until this
 *      change) silently running the LOCAL side: the mutation mirror plus
 *      `/factory/sync/*` routes on the public mutation server.
 *   2. The inverse trap introduced by fixing (1) — defaulting to `cloud` and
 *      thereby registering `GET /factory/tournaments`, an unbounded
 *      `listTournamentIds()` (punch-list A7 offender), on every instance that
 *      had merely left the variable unset.
 */

const ORIGINAL = { ...process.env };

// A scoped env replacement is not usable here: the module factory reads
// `process.env` during `forRoot()`, and each case needs a different environment
// established BEFORE that call.
afterEach(() => {
  process.env = { ...ORIGINAL };
});

function build() {
  const moduleDef = TournamentSyncModule.forRoot();
  return {
    controllers: (moduleDef.controllers ?? []) as unknown[],
    providers: (moduleDef.providers ?? []) as unknown[],
  };
}

describe('TournamentSyncModule.forRoot', () => {
  describe('default environment (INSTANCE_ROLE unset)', () => {
    beforeEach(() => {
      delete process.env.INSTANCE_ROLE;
      delete process.env.UPSTREAM_API_KEY;
    });

    it('registers NO controllers and no local-side services', () => {
      const { controllers, providers } = build();

      expect(controllers).toEqual([]);
      expect(providers).not.toContain(MutationMirrorService);
      expect(providers).not.toContain(TournamentSyncService);
    });

    it('does not expose the sync routes that regression (1) put on production', () => {
      expect(build().controllers).not.toContain(TournamentSyncController);
    });

    it('does not expose the unbounded export route — regression (2)', () => {
      expect(build().controllers).not.toContain(TournamentExportController);
    });
  });

  describe('cloud role', () => {
    beforeEach(() => {
      process.env.INSTANCE_ROLE = 'cloud';
    });

    it('withholds the export controller until federation is configured', () => {
      delete process.env.UPSTREAM_API_KEY;
      expect(build().controllers).not.toContain(TournamentExportController);
    });

    it('registers the export controller once UPSTREAM_API_KEY is set', () => {
      process.env.UPSTREAM_API_KEY = 'service-key';
      expect(build().controllers).toContain(TournamentExportController);
    });

    it('never registers local-side services', () => {
      process.env.UPSTREAM_API_KEY = 'service-key';
      const { providers, controllers } = build();

      expect(providers).not.toContain(MutationMirrorService);
      expect(providers).not.toContain(TournamentSyncService);
      expect(controllers).not.toContain(TournamentSyncController);
    });
  });

  describe('local role (must be opted into explicitly)', () => {
    beforeEach(() => {
      process.env.INSTANCE_ROLE = 'local';
    });

    it('registers the mirror, the sync service and the sync controller', () => {
      const { providers, controllers } = build();

      expect(providers).toContain(MutationMirrorService);
      expect(providers).toContain(TournamentSyncService);
      expect(controllers).toContain(TournamentSyncController);
    });

    it('does not register the cloud export controller', () => {
      process.env.UPSTREAM_API_KEY = 'service-key';
      expect(build().controllers).not.toContain(TournamentExportController);
    });
  });

  it('treats an unrecognised INSTANCE_ROLE as cloud, not local', () => {
    // The fail-closed direction: a typo must not grant local-side behaviour.
    process.env.INSTANCE_ROLE = 'locl';
    delete process.env.UPSTREAM_API_KEY;
    const { providers, controllers } = build();

    expect(providers).not.toContain(MutationMirrorService);
    expect(controllers).toEqual([]);
  });
});
