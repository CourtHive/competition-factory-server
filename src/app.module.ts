import { FactoryController } from './providers/factory/factory.controller';
import { FactoryService } from './providers/factory/factory.service';
import { UsersModule } from './providers/users/users.module';
import { ConfigsModule } from './config/config.module';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { AppService } from './app.service';
import { Module } from '@nestjs/common';

import { TrackerModule } from './messaging/tracker/tracker.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

@Module({
  imports: [
    ConfigsModule,
    AuthModule,
    TrackerModule,
    UsersModule,
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'client'),
    }),
  ],
  controllers: [AppController, FactoryController],
  providers: [AppService, FactoryService],
})
export class AppModule {}
