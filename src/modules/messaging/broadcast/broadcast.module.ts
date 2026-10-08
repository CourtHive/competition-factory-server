import { ProjectorsModule } from 'src/modules/projectors/projectors.module';
import { TournamentBroadcastService } from './tournament-broadcast.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { Module } from '@nestjs/common';

@Module({
  imports: [RealtimeModule, ProjectorsModule],
  providers: [TournamentBroadcastService],
  exports: [TournamentBroadcastService],
})
export class BroadcastModule {}
