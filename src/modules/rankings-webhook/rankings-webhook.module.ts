import { Module } from '@nestjs/common';

import { RankingsWebhookController } from './rankings-webhook.controller';
import { RankingsWebhookService } from './rankings-webhook.service';
import { ProviderRankingsService } from './provider-rankings.service';

@Module({
  controllers: [RankingsWebhookController],
  providers: [RankingsWebhookService, ProviderRankingsService],
  exports: [RankingsWebhookService, ProviderRankingsService],
})
export class RankingsWebhookModule {}
