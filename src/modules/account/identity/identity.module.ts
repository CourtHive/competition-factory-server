import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { AuditModule } from '../../audit/audit.module';
import { EmailModule } from '../email/email.module';
import { ConfigsModule } from 'src/config/config.module';
import { Module } from '@nestjs/common';

@Module({
  imports: [ConfigsModule, EmailModule, AuditModule],
  providers: [IdentityService],
  controllers: [IdentityController],
  exports: [IdentityService],
})
export class IdentityModule {}
