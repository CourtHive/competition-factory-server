import { Module } from '@nestjs/common';

import { RankingsProxyController } from './rankings-proxy.controller';

@Module({
  controllers: [RankingsProxyController],
})
export class RankingsProxyModule {}
