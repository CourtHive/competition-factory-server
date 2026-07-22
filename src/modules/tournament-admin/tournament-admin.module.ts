/**
 * TournamentAdminModule — the SURVIVOR home for the STAY tournament-admin
 * surfaces re-parented out of the MOVE AccountModule (Phase-3, plan §2c):
 * registrations (accept), declarations (availability pull), and sanctioning
 * (activation bridge, imported transitively by RegistrationsModule). These sit
 * on the CFS mutation path (FactoryModule + executionQueue) and never move to
 * the IdP, so AppModule imports them here instead of via AccountModule — the
 * AccountModule drop then leaves them untouched.
 *
 * RegistrationsModule / DeclarationsModule physically remain under account/ for
 * now (imported as allowlisted module entrypoints); their physical relocation to
 * a neutral CFS path is Phase-4 cleanup.
 */
import { Module } from '@nestjs/common';

import { RegistrationsModule } from 'src/modules/account/registrations/registrations.module';
import { DeclarationsModule } from 'src/modules/account/declarations/declarations.module';

@Module({
  imports: [RegistrationsModule, DeclarationsModule],
  exports: [RegistrationsModule, DeclarationsModule],
})
export class TournamentAdminModule {}
