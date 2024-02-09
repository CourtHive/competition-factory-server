import { ConversionController } from './conversion.controller';
import { ConversionService } from './conversion.service';
import { Module } from '@nestjs/common';

@Module({
  controllers: [ConversionController],
  providers: [ConversionService],
  exports: [ConversionService],
})
export class ConversionModule {}
