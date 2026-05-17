import 'core-js/actual/array/to-sorted';

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
    allowedHeaders: ['Content-Type', 'Authorization', 'If-None-Match'],
    // Browsers hide non-safelisted response headers from cross-origin
    // JavaScript by default. `ETag` is what TMX's i18n runtime-loader
    // reads to detect locale versions and populate its localStorage
    // cache — without exposing it explicitly here, `response.headers.etag`
    // is `undefined` in the browser, the cache is never written, and
    // language switching silently falls back to English on reload.
    exposedHeaders: ['ETag'],
    origin: '*',
  });

  /**
  await app.register(cookieParser);
  */
  app.use(compression());
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

  const config = app.get(ConfigService);
  const appName = config.get('APP.name');
  const port = config.get('APP.port');

  await app.listen(port, '0.0.0.0');
  Logger.verbose(`Application ${appName} is running on: ${await app.getUrl()}`);
  Logger.verbose(`Server version: ${serverVersion}`);
  Logger.verbose(`Factory ${version()}`);
}

bootstrap();
