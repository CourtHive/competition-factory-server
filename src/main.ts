import 'core-js/actual/array/to-sorted';

import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { version as serverVersion } from '../package.json';
import { AppModule } from './modules/app/app.module';
import { version } from 'tods-competition-factory';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
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
    .setDescription(
      'REST API for the Competition Factory Server. Authenticate with a Bearer token — a provider ' +
        'API key (`pkey_live_*`), a provisioner API key (`prov_sk_live_*`), or a user JWT. Click ' +
        '**Authorize** and paste the token. For provisioner calls on behalf of a provider, also send ' +
        'an `X-Provider-Id` header (use curl or a REST client; it is not part of the generated parameters).',
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'Token', description: 'pkey_live_… / prov_sk_live_… / user JWT' },
      'bearer',
    )
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig, {
    // deepScanRoutes: true,
  });
  // Apply the bearer scheme globally so the Authorize button in the explorer
  // covers every operation. Public endpoints simply ignore the token.
  document.security = [{ bearer: [] }];

  // In production the Swagger explorer + spec are gated behind HTTP Basic auth
  // so the full API surface isn't publicly browsable. Only the Swagger-owned
  // paths are gated — real `/api/*` controllers (e.g. /api/config,
  // /api/bolt-history) are deliberately left untouched. Fail-safe: if no
  // credentials are configured in production, the explorer is not mounted at all.
  const swaggerLocked = process.env.NODE_ENV === 'production' || process.env.APP_MODE === 'production';
  const swaggerUser = process.env.SWAGGER_USER;
  const swaggerPassword = process.env.SWAGGER_PASSWORD;

  if (swaggerLocked && !(swaggerUser && swaggerPassword)) {
    Logger.warn(
      'Swagger UI not mounted: set SWAGGER_USER and SWAGGER_PASSWORD to expose it behind Basic auth in production.',
      'Bootstrap',
    );
  } else {
    if (swaggerLocked) {
      const isSwaggerPath = (p: string): boolean =>
        p === '/api' ||
        p === '/api/' ||
        p === '/api-json' ||
        p === '/api-yaml' ||
        p.startsWith('/api/swagger-ui') ||
        p === '/api/index.css' ||
        p.startsWith('/api/favicon');
      const safeEqual = (a: string, b: string): boolean =>
        timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
      app.use((req: any, res: any, next: () => void) => {
        if (!isSwaggerPath(req.path)) return next();
        const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
        if (scheme === 'Basic' && encoded) {
          const decoded = Buffer.from(encoded, 'base64').toString();
          const idx = decoded.indexOf(':');
          if (idx >= 0 && safeEqual(decoded.slice(0, idx), swaggerUser as string) && safeEqual(decoded.slice(idx + 1), swaggerPassword as string)) {
            return next();
          }
        }
        res.set('WWW-Authenticate', 'Basic realm="CFS API docs"');
        res.status(401).send('Authentication required');
      });
    }
    SwaggerModule.setup('api', app, document);
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
