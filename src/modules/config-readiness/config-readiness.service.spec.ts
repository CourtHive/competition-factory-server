import { ConfigReadinessService } from './config-readiness.service';

describe('ConfigReadinessService', () => {
  let service: ConfigReadinessService;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    service = new ConfigReadinessService();
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  });

  afterAll(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, originalEnv);
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
