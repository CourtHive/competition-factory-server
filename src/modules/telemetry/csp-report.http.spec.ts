import { Test } from '@nestjs/testing';
import { Logger, type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

import { CSP_REPORT_PATH, cspReportParser } from './csp-report.parser';
import { CspReportController } from './csp-report.controller';

/**
 * The route through real HTTP: the report content types are parsed (the app-wide JSON parser ignores
 * them), the answer is 204, and an unparseable body is still 204. main.ts mounts the same parser.
 */
describe('POST /csp-report', () => {
  let app: INestApplication;
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [CspReportController] }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    app.use(CSP_REPORT_PATH, cspReportParser());
    await app.init();
  });

  afterAll(async () => {
    warn.mockRestore();
    await app.close();
  });

  it('parses an application/csp-report body and answers 204', async () => {
    warn.mockClear();
    const body = {
      'csp-report': { 'effective-directive': 'script-src-elem', 'blocked-uri': 'https://evil.example/x.js' },
    };
    await request(app.getHttpServer())
      .post(CSP_REPORT_PATH)
      .set('Content-Type', 'application/csp-report')
      .send(JSON.stringify(body))
      .expect(204);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('script-src-elem blocked https://evil.example/x.js');
  });

  it('parses an application/reports+json body', async () => {
    warn.mockClear();
    const body = [
      { type: 'csp-violation', body: { effectiveDirective: 'connect-src', blockedURL: 'https://a.example/' } },
    ];
    await request(app.getHttpServer())
      .post(CSP_REPORT_PATH)
      .set('Content-Type', 'application/reports+json')
      .send(JSON.stringify(body))
      .expect(204);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('answers 204 and logs nothing for a body that is not a report', async () => {
    warn.mockClear();
    await request(app.getHttpServer())
      .post(CSP_REPORT_PATH)
      .set('Content-Type', 'text/plain')
      .send('hello')
      .expect(204);
    expect(warn).not.toHaveBeenCalled();
  });
});
