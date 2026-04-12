import { BoltHistoryReportsController } from './bolt-history-reports.controller';
import { BroadcastModule } from '../messaging/broadcast/broadcast.module';
import { BoltHistoryController } from './bolt-history.controller';
import { ProjectorsModule } from '../projectors/projectors.module';
import { BoltHistoryService } from './bolt-history.service';
import { FactoryModule } from '../factory/factory.module';
import { RelayModule } from '../relay/relay.module';
import { Module } from '@nestjs/common';

@Module({
  imports: [BroadcastModule, ProjectorsModule, RelayModule.forRoot(), FactoryModule],
  providers: [BoltHistoryService],
  controllers: [BoltHistoryController, BoltHistoryReportsController],
  exports: [BoltHistoryService],
})
export class BoltHistoryModule {}
