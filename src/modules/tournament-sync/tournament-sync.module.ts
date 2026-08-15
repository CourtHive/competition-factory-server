import { DynamicModule, Module, Provider, Type } from '@nestjs/common';

import { TournamentExportController } from './tournament-export.controller';
import { TournamentSyncController } from './tournament-sync.controller';
import { isFederationConfigured, resolveInstanceRole } from '../relay/relay.config';
import { MutationMirrorService } from './mutation-mirror.service';
import { TournamentSyncService } from './tournament-sync.service';
import { RelayConfig } from '../relay/relay.config';

/**
 * Conditionally loads tournament sync infrastructure based on INSTANCE_ROLE
 * (defaults to `cloud` — see `resolveInstanceRole` for why):
 *
 * - **cloud**: TournamentExportController (serves tournament records to local
 *              instances) — ONLY when federation is configured
 * - **local**: TournamentSyncService + TournamentSyncController (pulls from upstream),
 *              MutationMirrorService (mirrors mutations to upstream)
 *
 * An unconfigured cloud instance — the normal case, including production —
 * therefore registers nothing but `RelayConfig`.
 */
@Module({})
export class TournamentSyncModule {
  static forRoot(): DynamicModule {
    const isCloud = resolveInstanceRole() === 'cloud';

    const providers: Provider[] = [RelayConfig];
    const exports: Provider[] = [];
    const controllers: Type<unknown>[] = [];

    if (isCloud) {
      // Gated: registering the export controller unconditionally would put an
      // unbounded `listTournamentIds()` route on every default-configured
      // instance. See `isFederationConfigured`.
      if (isFederationConfigured()) controllers.push(TournamentExportController);
    } else {
      providers.push(TournamentSyncService, MutationMirrorService);
      exports.push(TournamentSyncService, MutationMirrorService);
      controllers.push(TournamentSyncController);
    }

    return {
      global: true,
      module: TournamentSyncModule,
      providers,
      controllers,
      exports,
    };
  }
}
