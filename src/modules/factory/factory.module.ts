import { FactoryController } from './factory.controller';
import { ConfigsModule } from 'src/config/config.module';
import { FactoryService } from './factory.service';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Module({
  providers: [FactoryService, ConfigService],
  controllers: [FactoryController],
  exports: [FactoryService],
  imports: [ConfigsModule],
})
export class FactoryModule {}
