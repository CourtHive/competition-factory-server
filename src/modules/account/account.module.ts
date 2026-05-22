/**
 * AccountModule — public surface of the `src/modules/account/` tree.
 *
 * Aggregates everything related to user identity, authentication, and
 * outbound transactional email. AppModule imports AccountModule rather
 * than the inner Auth/Email modules directly so the wiring point is
 * stable when the account tree is eventually lifted out into its own
 * microservice (see Mentat/planning/ACCOUNT_SERVICE_BOUNDARY.md).
 *
 * Boundary rule: nothing outside `src/modules/account/` should import
 * from inside it except via this module. Exceptions (cross-cutting
 * infrastructure that both processes need) are documented in the
 * boundary planning doc.
 */
import { EmailModule } from './email/email.module';
import { AuthModule } from './auth/auth.module';
import { Module } from '@nestjs/common';

@Module({
  imports: [AuthModule, EmailModule],
  exports: [AuthModule, EmailModule],
})
export class AccountModule {}
