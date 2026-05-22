/**
 * EmailModule — wires the EmailService + the active EmailAdapter.
 *
 * Switching vendors is one provider line below — replace ResendAdapter
 * with PostmarkAdapter / SesAdapter / etc. The EmailService and all its
 * callers stay untouched.
 */
import { EMAIL_ADAPTER } from './adapters/email-adapter.interface';
import { ResendAdapter } from './adapters/resend.adapter';
import { EmailService } from './email.service';
import { ConfigsModule } from 'src/config/config.module';
import { Module } from '@nestjs/common';

@Module({
  imports: [ConfigsModule],
  providers: [
    {
      provide: EMAIL_ADAPTER,
      useClass: ResendAdapter,
    },
    EmailService,
  ],
  exports: [EmailService],
})
export class EmailModule {}
