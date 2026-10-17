/**
 * Content Security Policy violation reports, normalised to one short line each.
 *
 * TMX ships its CSP report-only first (TMX `csp.policy.mjs`): the browser blocks nothing and POSTs what
 * it would have blocked here. Two wire formats arrive, depending on the browser and on which directive
 * named the endpoint:
 *
 * - `report-uri` → `application/csp-report`: `{ "csp-report": { "document-uri", "violated-directive",
 *   "effective-directive", "blocked-uri", "source-file", "line-number", "script-sample" } }`
 * - Reporting API → `application/reports+json`: `[{ type: "csp-violation", url, body: { documentURL,
 *   effectiveDirective, blockedURL, sourceFile, lineNumber, sample } }]`
 *
 * Everything in a report is client-supplied, so every field is clipped and the query string and
 * fragment are dropped from URLs: a document URL can carry a tournament id in its hash, and a token in
 * a query string must never reach a log.
 */

export interface CspViolation {
  document: string;
  directive: string;
  blocked: string;
  source: string;
  line?: number;
  sample: string;
}

const MAX_FIELD = 200;
const MAX_REPORTS = 20;

function clip(value: unknown, max = MAX_FIELD): string {
  if (typeof value !== 'string') return '';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Drops the query and fragment; keywords such as `inline` or `eval` pass through unchanged. */
function stripUrl(value: unknown): string {
  const text = clip(value, 1000);
  return clip(text.split(/[?#]/)[0]);
}

function toLine(value: unknown): number | undefined {
  const line = Number(value);
  return Number.isInteger(line) && line > 0 ? line : undefined;
}

function fromCspReport(report: any): CspViolation {
  return {
    document: stripUrl(report['document-uri']),
    directive: clip(report['effective-directive'] || report['violated-directive'], 60),
    blocked: stripUrl(report['blocked-uri']),
    source: stripUrl(report['source-file']),
    line: toLine(report['line-number']),
    sample: clip(report['script-sample'], 80),
  };
}

function fromReportingApi(body: any, url: unknown): CspViolation {
  return {
    document: stripUrl(body.documentURL ?? url),
    directive: clip(body.effectiveDirective, 60),
    blocked: stripUrl(body.blockedURL),
    source: stripUrl(body.sourceFile),
    line: toLine(body.lineNumber),
    sample: clip(body.sample, 80),
  };
}

/** Every violation a request body carries, in either format; anything unrecognised yields none. */
export function parseCspReports(payload: unknown): CspViolation[] {
  if (Array.isArray(payload)) {
    return payload
      .slice(0, MAX_REPORTS)
      .filter((entry) => entry?.type === 'csp-violation' && entry.body && typeof entry.body === 'object')
      .map((entry) => fromReportingApi(entry.body, entry.url))
      .filter((violation) => violation.directive);
  }
  const report = (payload as any)?.['csp-report'];
  if (report && typeof report === 'object') {
    const violation = fromCspReport(report);
    return violation.directive ? [violation] : [];
  }
  return [];
}

export function formatCspViolation(violation: CspViolation): string {
  const where = violation.source ? ` at ${violation.source}${violation.line ? `:${violation.line}` : ''}` : '';
  const sample = violation.sample ? ` sample=${JSON.stringify(violation.sample)}` : '';
  return `${violation.directive} blocked ${violation.blocked || '(none)'} on ${violation.document || '(unknown)'}${where}${sample}`;
}
