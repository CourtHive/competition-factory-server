import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { version as serverVersion } from '../package.json';
import { AppModule } from './modules/app/app.module';
import { version } from 'tods-competition-factory';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import compression from 'compression';
import { json } from 'body-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['fatal', 'verbose', 'debug', 'error', 'warn'] });
  app.enableCors({
    methods: ['GET', 'POST'],
    allowedHeaders: '*',
    origin: '*',
  });

  /**
  await app.register(cookieParser);
  */
  await app.use(compression());
  app.use(json({ limit: '8mb' }));

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Competition Factory Server API')
    .setDescription('API description')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig, {
    // deepScanRoutes: true,
  });
  SwaggerModule.setup('api', app, document);

  if (!Array.prototype.hasOwnProperty('toSorted')) {
    Object.defineProperty(Array.prototype, 'toSorted', {
      value: function (compareFn) {
        return this.slice().sort(compareFn);
      },
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }

  const config = app.get(ConfigService);
  const appName = config.get('APP.name');
  const port = config.get('APP.port');

  await app.listen(port, '0.0.0.0');
  Logger.verbose(`Application ${appName} is running on: ${await app.getUrl()}`);
  Logger.verbose(`Server version: ${serverVersion}`);
  Logger.verbose(`Factory ${version()}`);
}
bootstrap();
