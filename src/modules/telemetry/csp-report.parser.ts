import { json } from 'body-parser';

export const CSP_REPORT_PATH = '/csp-report';

/**
 * CSP violation reports arrive as `application/csp-report` (report-uri) or `application/reports+json`
 * (Reporting API), which the app-wide JSON parser ignores. Mounted on the report path ahead of it, and
 * small: a report is a few hundred bytes.
 */
export const cspReportParser = () =>
  json({ type: ['application/csp-report', 'application/reports+json', 'application/json'], limit: '64kb' });
