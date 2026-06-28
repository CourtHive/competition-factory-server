import 'core-js/actual/array/to-sorted';

import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { version as serverVersion } from '../package.json';
import { AppModule } from './modules/app/app.module';
import { version } from 'tods-competition-factory';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AuthService } from './modules/account/auth/auth.service';
import compression from 'compression';
import { json } from 'body-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['fatal', 'verbose', 'debug', 'error', 'warn'] });
  app.enableCors({
    // PUT/PATCH/DELETE back the console's edit flows (provider settings, user +
    // provisioner management). Same-origin in prod (NGINX), but cross-origin in
    // dev/e2e (console on a separate Vite port) — without these the browser
    // blocks the preflight and the edit silently fails (net::ERR_FAILED).
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
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
      'REST API for the Competition Factory Server.\n\n' +
        '**There are two separate auth steps — they are easy to confuse:**\n\n' +
        '1. **Signing in to view this page.** You already did this with your CourtHive account ' +
        '(super-admin, provisioner, or provider-admin). It only unlocks the documentation.\n' +
        '2. **Authorizing API calls.** To actually run a request with *Try it out*, click ' +
        '**Authorize** (top-right) and paste a **Bearer token** — this is *not* the same as the ' +
        'login above. Use a provider API key (`pkey_live_…`), a provisioner API key ' +
        '(`prov_sk_live_…`), or a user **JWT** from `POST /auth/login`. Paste only the token ' +
        '(no `Bearer ` prefix).\n\n' +
        'For provisioner calls on behalf of a provider, also send an `X-Provider-Id` header ' +
        '(a custom header — use curl or a REST client, as the *Try it out* form has no field for it).',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'Token',
        description:
          'Token for CALLING endpoints — NOT the account login that opened this page. Paste a ' +
          'provider API key (pkey_live_…), a provisioner API key (prov_sk_live_…), or a user JWT ' +
          'from POST /auth/login. No "Bearer " prefix.',
      },
      'bearer',
    )
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig, {
    // deepScanRoutes: true,
  });
  // Apply the bearer scheme globally so the Authorize button in the explorer
  // covers every operation. Public endpoints simply ignore the token.
  document.security = [{ bearer: [] }];

  // The Swagger explorer + spec are gated behind HTTP Basic auth on any host
  // that talks to the shared/production database. Credentials are real accounts
  // — SUPER_ADMIN, PROVISIONER, or PROVIDER_ADMIN users (the ones who actually
  // exercise the API) — validated by AuthService against the users table. Only
  // Swagger-owned paths are gated; real `/api/*` controllers (e.g. /api/config,
  // /api/bolt-history) are untouched.
  //
  // Gating triggers for production (nest) AND the shared-DB staging host
  // (courthive-mentat — runs APP_MODE=development but points at the same
  // Postgres), which sets SWAGGER_REQUIRE_AUTH=true. Isolated local dev with
  // its own database leaves all three unset and keeps the explorer open.
  const swaggerLocked =
    process.env.SWAGGER_REQUIRE_AUTH === 'true' ||
    process.env.NODE_ENV === 'production' ||
    process.env.APP_MODE === 'production';
  if (swaggerLocked) {
    const authService = app.get(AuthService);
    const isSwaggerPath = (p: string): boolean =>
      p === '/api' ||
      p === '/api/' ||
      p === '/api-json' ||
      p === '/api-yaml' ||
      p.startsWith('/api/swagger-ui') ||
      p === '/api/index.css' ||
      p.startsWith('/api/favicon');
    app.use(async (req: any, res: any, next: () => void) => {
      if (!isSwaggerPath(req.path)) return next();
      const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
      if (scheme === 'Basic' && encoded) {
        const decoded = Buffer.from(encoded, 'base64').toString();
        const idx = decoded.indexOf(':');
        if (idx >= 0) {
          try {
            if (await authService.canAccessApiDocs(decoded.slice(0, idx), decoded.slice(idx + 1))) {
              return next();
            }
          } catch {
            // fall through to 401
          }
        }
      }
      res.set('WWW-Authenticate', 'Basic realm="CFS API docs"');
      res.status(401).send('Authentication required');
    });
  }
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
