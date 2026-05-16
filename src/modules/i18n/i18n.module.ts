import { I18nController } from './i18n.controller';
import { I18nService } from './i18n.service';
import { Module } from '@nestjs/common';

@Module({
  controllers: [I18nController],
  providers: [I18nService],
  exports: [I18nService],
})
export class I18nModule {}
