import { ProjectorsModule } from 'src/modules/projectors/projectors.module';
import { TournamentBroadcastService } from './tournament-broadcast.service';
import { PublicModule } from '../public/public.module';
import { Module } from '@nestjs/common';

@Module({
  imports: [PublicModule, ProjectorsModule],
  providers: [TournamentBroadcastService],
  exports: [TournamentBroadcastService],
})
export class BroadcastModule {}
