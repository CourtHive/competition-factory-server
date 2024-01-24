import { ConversionModule } from './providers/conversion/conversion.module';
import { FactoryModule } from './providers/factory/factory.module';
import { MessagingModule } from './messaging/messaging.module';
import { UsersModule } from './providers/users/users.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ConfigsModule } from './config/config.module';
import { AuthModule } from './auth/auth.module';

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
    ServeStaticModule.forRoot({ rootPath: join(__dirname, '..', 'client') }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
