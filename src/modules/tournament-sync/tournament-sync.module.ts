import { DynamicModule, Module, Provider, Type } from '@nestjs/common';

import { TournamentExportController } from './tournament-export.controller';
import { TournamentSyncController } from './tournament-sync.controller';
import { MutationMirrorService } from './mutation-mirror.service';
import { TournamentSyncService } from './tournament-sync.service';
import { RelayConfig } from '../relay/relay.config';

/**
 * Conditionally loads tournament sync infrastructure based on INSTANCE_ROLE:
 *
 * - **cloud**: TournamentExportController (serves tournament records to local instances)
 * - **local**: TournamentSyncService + TournamentSyncController (pulls from upstream),
 *              MutationMirrorService (mirrors mutations to upstream)
 */
@Module({})
export class TournamentSyncModule {
  static forRoot(): DynamicModule {
    const role = (process.env.INSTANCE_ROLE ?? 'local').toLowerCase();
    const isCloud = role === 'cloud';

    const providers: Provider[] = [RelayConfig];
    const exports: Provider[] = [];
    const controllers: Type<unknown>[] = [];

    if (isCloud) {
      controllers.push(TournamentExportController);
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
