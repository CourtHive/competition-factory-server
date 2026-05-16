import { Module } from '@nestjs/common';

import { RankingsWebhookController } from './rankings-webhook.controller';
import { RankingsWebhookService } from './rankings-webhook.service';

@Module({
  controllers: [RankingsWebhookController],
  providers: [RankingsWebhookService],
  exports: [RankingsWebhookService],
})
export class RankingsWebhookModule {}
