import { Body, Controller, INestApplication, Post, UnauthorizedException } from '@nestjs/common';
import { applyBodyParsers, resolveImportBodyLimit } from './bodyParsers';
import { Test } from '@nestjs/testing';
import request from 'supertest';

/**
 * The body limits as a Nest app applies them. The stub controller sits on the real import paths and refuses every
 * request with a 401, the way an unauthenticated import is refused — so a 401 proves the body got PAST the parser,
 * and a 413 proves the parser stopped it. Booting Nest (not a bare express app) keeps Nest's own body-parser
 * registration in the picture.
 */

@Controller()
class StubController {
  @Post('provider-key/tournaments')
  importTournaments(@Body() body: any) {
    throw new UnauthorizedException(`parsed ${JSON.stringify(body).length}`);
  }

  @Post('factory/save')
  save(@Body() body: any) {
    throw new UnauthorizedException(`parsed ${JSON.stringify(body).length}`);
  }

  @Post('factory/save-status')
  saveStatus(@Body() body: any) {
    return { parsed: JSON.stringify(body).length };
  }

  @Post('factory')
  executionQueue(@Body() body: any) {
    return { parsed: JSON.stringify(body).length };
  }
}

const sizedBody = (bytes: number) => JSON.stringify({ payload: 'a'.repeat(bytes) });
const NINE_MB = 9 * 1024 * 1024;
const ONE_MB = 1024 * 1024;

describe('request body limits', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [StubController] }).compile();
    app = moduleRef.createNestApplication();
    applyBodyParsers(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (path: string, body: string) =>
    request(app.getHttpServer()).post(path).set('Content-Type', 'application/json').send(body);

  it.each(['/provider-key/tournaments', '/factory/save'])(
    'parses a body over 8 MB on the import route %s',
    async (path) => {
      const res = await post(path, sizedBody(NINE_MB));
      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/^parsed \d+$/);
    },
  );

  it.each(['/factory', '/factory/save-status'])(
    'refuses a body over 8 MB on %s (not an import route)',
    async (path) => {
      const res = await post(path, sizedBody(NINE_MB));
      expect(res.status).toBe(413);
    },
  );

  it('still parses an ordinary body on a non-import route', async () => {
    const res = await post('/factory', sizedBody(ONE_MB));
    expect(res.status).toBe(201);
  });
});

describe('resolveImportBodyLimit', () => {
  it('defaults to 64mb when unset or blank', () => {
    expect(resolveImportBodyLimit(undefined)).toEqual({ limit: '64mb' });
    expect(resolveImportBodyLimit('  ')).toEqual({ limit: '64mb' });
  });

  it.each(['32mb', '100MB', '1.5gb', '5000000', '512 kb'])('takes the size %s', (raw) => {
    expect(resolveImportBodyLimit(raw)).toEqual({ limit: raw });
  });

  // fails closed: a value that is not a size gets the app limit, not the larger default
  it.each(['64 megs', 'mb', '-1mb', 'lots'])('falls back to the 8mb app limit, naming %s as invalid', (raw) => {
    expect(resolveImportBodyLimit(raw)).toEqual({ limit: '8mb', invalid: raw });
  });
});
