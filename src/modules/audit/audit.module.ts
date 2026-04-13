import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { Module } from '@nestjs/common';

@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
