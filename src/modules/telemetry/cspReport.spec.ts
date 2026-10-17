import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';

import { formatCspViolation, parseCspReports } from './cspReport';
import { CspReportController } from './csp-report.controller';

const legacy = {
  'csp-report': {
    'document-uri': 'https://courthive.net/tmx/?token=secret#/tournament/abc',
    'violated-directive': 'script-src-attr',
    'effective-directive': 'script-src-attr',
    'blocked-uri': 'inline',
    'source-file': 'https://courthive.net/tmx/assets/index-abc.js?v=1',
    'line-number': 42,
    'script-sample': 'globalThis.__xss=1',
  },
};

const reportingApi = [
  {
    type: 'csp-violation',
    url: 'https://courthive.net/tmx/#/x',
    body: {
      documentURL: 'https://courthive.net/tmx/#/tournament/abc',
      effectiveDirective: 'connect-src',
      blockedURL: 'https://api.example.com/v1?key=k',
      sourceFile: 'https://courthive.net/tmx/assets/index-abc.js',
      lineNumber: 7,
    },
  },
  { type: 'deprecation', body: { id: 'x' } },
];

describe('parseCspReports', () => {
  it('reads a report-uri (application/csp-report) body', () => {
    expect(parseCspReports(legacy)).toEqual([
      {
        document: 'https://courthive.net/tmx/',
        directive: 'script-src-attr',
        blocked: 'inline',
        source: 'https://courthive.net/tmx/assets/index-abc.js',
        line: 42,
        sample: 'globalThis.__xss=1',
      },
    ]);
  });

  it('reads Reporting API (application/reports+json) entries and skips other report types', () => {
    const [violation, ...rest] = parseCspReports(reportingApi);
    expect(rest).toEqual([]);
    expect(violation).toMatchObject({ directive: 'connect-src', blocked: 'https://api.example.com/v1', line: 7 });
  });

  it('drops query strings and fragments, so no token or tournament id reaches the log', () => {
    const line = formatCspViolation(parseCspReports(legacy)[0]);
    expect(line).not.toContain('secret');
    expect(line).not.toContain('abc#');
    expect(line).not.toContain('/tournament/abc');
  });

  it('clips oversized client-supplied fields and caps the entries read from one body', () => {
    const huge = {
      'csp-report': { 'effective-directive': 'img-src', 'blocked-uri': `https://x.example/${'a'.repeat(5000)}` },
    };
    expect(parseCspReports(huge)[0].blocked.length).toBeLessThanOrEqual(201);
    const many = Array.from({ length: 100 }, () => reportingApi[0]);
    expect(parseCspReports(many)).toHaveLength(20);
  });

  it('yields nothing for bodies that are not reports', () => {
    for (const body of [
      undefined,
      null,
      'text',
      {},
      { 'csp-report': 'x' },
      [{ type: 'csp-violation' }],
      { 'csp-report': {} },
    ]) {
      expect(parseCspReports(body)).toEqual([]);
    }
  });
});

describe('CspReportController', () => {
  it('logs one warning per violation and returns nothing (the route answers 204)', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const controller = new CspReportController();
    expect(controller.receive(legacy)).toBeUndefined();
    controller.receive(reportingApi);
    controller.receive({ junk: true });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toContain('script-src-attr blocked inline on https://courthive.net/tmx/');
    warn.mockRestore();
  });
});
