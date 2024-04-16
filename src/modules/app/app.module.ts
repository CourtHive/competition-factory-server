import { MessagingModule } from '../messaging/messaging.module';
import { ProvidersModule } from '../providers/providers.module';
import { ServicesModule } from '../services/services.module';
import { FactoryModule } from '../factory/factory.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ConfigsModule } from '../../config/config.module';
import { CacheModule } from '../cache/cache.module';
import { UsersModule } from '../users/users.module';
import { AppController } from './app.controller';
import { AuthModule } from '../auth/auth.module';
import { AppService } from './app.service';
import { Module } from '@nestjs/common';
import { join } from 'path';

@Module({
  imports: [
    ServeStaticModule.forRoot({ rootPath: join(__dirname, '../../..', 'client') }),
    MessagingModule,
    ProvidersModule,
    ServicesModule,
    FactoryModule,
    ConfigsModule,
    UsersModule,
    CacheModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
