import { FactoryController } from './factory.controller';
import { ConfigsModule } from 'src/config/config.module';
import { FactoryService } from './factory.service';
import { ConfigService } from '@nestjs/config';
import { Module } from '@nestjs/common';

@Module({
  providers: [FactoryService, ConfigService],
  controllers: [FactoryController],
  exports: [FactoryService],
  imports: [ConfigsModule],
})
export class FactoryModule {}
