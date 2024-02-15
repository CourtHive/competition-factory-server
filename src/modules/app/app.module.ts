import { ConversionModule } from '../conversion/conversion.module';
import { FactoryModule } from '../factory/factory.module';
import { MessagingModule } from '../messaging/messaging.module';
import { CacheModule } from '../cache/cache.module';
import { UsersModule } from '../users/users.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ConfigsModule } from '../../config/config.module';
import { AuthModule } from '../auth/auth.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { Module } from '@nestjs/common';
import { join } from 'path';

@Module({
  imports: [
    ConfigsModule,
    AuthModule,
    MessagingModule,
    FactoryModule,
    ConversionModule,
    UsersModule,
    CacheModule,
    ServeStaticModule.forRoot({ rootPath: join(__dirname, '..', 'client') }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
