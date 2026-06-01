import { ConfigReadinessService } from './config-readiness.service';

// F2 (architectural-standards.md A6): the previous wipe-and-restore-on-
// `beforeEach` shape works only if no test throws between the mutation
// and the next beforeEach. `jest.replaceProperty` is restored at the
// end of each test by Jest itself — robust even if the test body
// throws unhandled.

describe('ConfigReadinessService', () => {
  let service: ConfigReadinessService;
  const baselineEnv = { ...process.env };

  beforeEach(() => {
    service = new ConfigReadinessService();
    // Replace the whole process.env with a fresh copy of the captured
    // baseline. Per-test mutations land on this replacement and are
    // discarded at test teardown.
    jest.replaceProperty(process, 'env', { ...baselineEnv });
  });

  function get(name: string, report = service.runAndLog('manual')): ReturnType<ConfigReadinessService['runAndLog']>['checks'][number] {
    const found = report.checks.find((c) => c.name === name);
    if (!found) throw new Error(`expected check ${name}`);
    return found;
  }

  it('flags an unset JWT_SECRET as CRITICAL', () => {
    delete process.env.JWT_SECRET;
    const c = get('JWT_SECRET');
    expect(c.level).toBe('CRITICAL');
    expect(c.status).toBe('fail');
  });

  it('flags a placeholder-shaped JWT_SECRET as CRITICAL', () => {
    process.env.JWT_SECRET = 'Replace this string with a truly random string';
    const c = get('JWT_SECRET');
    expect(c.level).toBe('CRITICAL');
    expect(c.status).toBe('fail');
    expect(c.detail).toMatch(/placeholder/i);
  });

  it('accepts a strong JWT_SECRET', () => {
    process.env.JWT_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const c = get('JWT_SECRET');
    expect(c.status).toBe('ok');
  });

  // Letter-boundary tightening: substring matches inside high-entropy
  // secrets must NOT trip the placeholder heuristic, but recognizable
  // placeholders separated by non-letter tokens MUST trip it.
  it('does not flag a high-entropy secret that contains "changeme" embedded between letters', () => {
    // 'changeme' surrounded by lowercase letters — no letter-boundary,
    // so the regex shouldn't fire even though substring-match would.
    process.env.JWT_SECRET = 'q' + 'a'.repeat(20) + 'changeme' + 'z'.repeat(40);
    const c = get('JWT_SECRET');
    expect(c.status).toBe('ok');
  });

  it('flags "changeme" surrounded by non-letter separators (placeholder-style)', () => {
    process.env.JWT_SECRET = 'sk_changeme_xyz';
    const c = get('JWT_SECRET');
    expect(c.level).toBe('CRITICAL');
    expect(c.status).toBe('fail');
  });

  it('flags a JWT_SECRET equal to the bare placeholder token', () => {
    process.env.JWT_SECRET = 'changeme';
    const c = get('JWT_SECRET');
    expect(c.status).toBe('fail');
  });

  it('flags "placeholder" when written at the start of the value', () => {
    process.env.JWT_SECRET = 'placeholder-not-yet-rotated';
    const c = get('JWT_SECRET');
    expect(c.status).toBe('fail');
  });

  it('flags an unset EMAIL_FROM as WARN, not CRITICAL', () => {
    delete process.env.EMAIL_FROM;
    const c = get('EMAIL_FROM');
    expect(c.level).toBe('WARN');
    expect(c.status).toBe('warn');
  });

  it('caches the latest report for /admin/config/readiness consumers', () => {
    process.env.JWT_SECRET = 'real-secret-value-' + Math.random();
    service.runAndLog('manual');
    const cached = service.getLatestReport();
    expect(cached?.checks).toBeDefined();
    expect(cached?.summary.total).toBeGreaterThan(0);
  });

  it('summary counts add up to checks.length', () => {
    const report = service.runAndLog('manual');
    expect(report.summary.ok + report.summary.warn + report.summary.fail).toBe(report.checks.length);
  });
});
