import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

/**
 * Config readiness — runs at boot AND can be queried at any time via
 * GET /admin/config/readiness without restarting the server.
 *
 * Never blocks server start. Even a CRITICAL finding (placeholder
 * JWT_SECRET, missing DB creds) emits a loud delineated block at the
 * top of the log so the operator can choose to bounce — TMX traffic
 * keeps flowing in the meantime. The same block goes to /admin/config/
 * readiness as a structured JSON shape so deploy automation can decide.
 *
 * Add new checks by appending to `gatherChecks()`. Each check returns
 * { name, level, status, detail? } and the level controls the symbol
 * + log level. The output format is intentionally stable for
 * scripting on top of `grep`.
 */

export type CheckLevel = 'INFO' | 'WARN' | 'CRITICAL';
export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface ReadinessCheck {
  name: string;
  level: CheckLevel;
  status: CheckStatus;
  detail?: string;
}

export interface ReadinessReport {
  generatedAt: string;
  hostname: string;
  summary: { ok: number; warn: number; fail: number; total: number };
  checks: ReadinessCheck[];
}

const PLACEHOLDER_SECRET_HINTS = [
  'replace this',
  'placeholder',
  'change me',
  'changeme',
  'your-secret-here',
];

@Injectable()
export class ConfigReadinessService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ConfigReadinessService.name);
  private latestReport: ReadinessReport | null = null;

  onApplicationBootstrap(): void {
    this.runAndLog('boot');
  }

  /**
   * Run all checks, log a delineated block at the appropriate level,
   * cache the report for /admin/config/readiness consumers.
   */
  runAndLog(trigger: 'boot' | 'manual' = 'manual'): ReadinessReport {
    const checks = this.gatherChecks();
    const summary = checks.reduce(
      (acc, c) => {
        if (c.status === 'ok') acc.ok += 1;
        if (c.status === 'warn') acc.warn += 1;
        if (c.status === 'fail') acc.fail += 1;
        acc.total += 1;
        return acc;
      },
      { ok: 0, warn: 0, fail: 0, total: 0 },
    );
    const report: ReadinessReport = {
      generatedAt: new Date().toISOString(),
      hostname: process.env.HOSTNAME ?? 'unknown',
      summary,
      checks,
    };
    this.latestReport = report;
    this.emitBlock(report, trigger);
    return report;
  }

  getLatestReport(): ReadinessReport | null {
    return this.latestReport;
  }

  // ── Check definitions ──

  private gatherChecks(): ReadinessCheck[] {
    return [
      this.checkRequiredEnv('JWT_SECRET', { critical: true, suspectPlaceholder: true }),
      this.checkRequiredEnv('DATABASE_URL', { critical: false, fallbackHint: 'PG_* variables' }),
      this.checkRequiredEnv('EMAIL_FROM', {
        critical: false,
        warningWhenMissing: 'Resend will reject outbound mail.',
      }),
      this.checkRequiredEnv('APP_BASE_URL', {
        critical: false,
        warningWhenMissing:
          'Email-verification + password-reset link emails will use a placeholder URL.',
      }),
      this.checkRequiredEnv('PERSONS_BASE_URL', {
        critical: false,
        warningWhenMissing: 'PersonsClient will use the default http://localhost:3100.',
      }),
      this.checkRequiredEnv('RELAY_SERVICE_JWT', {
        critical: false,
        warningWhenMissing:
          'score-relay persistence will be anonymous (CFS RolesGuard rejects). Mint a SCORE-aud JWT and set this if relay-driven canonical persistence is in scope.',
      }),
      this.checkRequiredEnv('RESEND_API_KEY', {
        critical: false,
        warningWhenMissing: 'Outbound email is disabled until set.',
      }),
      this.checkNodeVersion(),
    ];
  }

  private checkRequiredEnv(
    name: string,
    options: {
      critical?: boolean;
      suspectPlaceholder?: boolean;
      fallbackHint?: string;
      warningWhenMissing?: string;
    } = {},
  ): ReadinessCheck {
    const raw = process.env[name]?.trim();
    if (!raw) {
      return {
        name,
        level: options.critical ? 'CRITICAL' : 'WARN',
        status: options.critical ? 'fail' : 'warn',
        detail:
          options.warningWhenMissing ??
          (options.fallbackHint
            ? `unset — ${options.fallbackHint} take over`
            : 'unset (using built-in default if any)'),
      };
    }
    if (options.suspectPlaceholder) {
      const lowered = raw.toLowerCase();
      const looksPlaceholder = PLACEHOLDER_SECRET_HINTS.some((hint) => lowered.includes(hint));
      if (looksPlaceholder) {
        return {
          name,
          level: 'CRITICAL',
          status: 'fail',
          detail: 'value matches the .env.example placeholder shape — DO NOT deploy this.',
        };
      }
    }
    return { name, level: 'INFO', status: 'ok' };
  }

  private checkNodeVersion(): ReadinessCheck {
    const major = parseInt(process.version.replace(/^v/, '').split('.')[0], 10);
    if (major >= 22) {
      return { name: 'node-version', level: 'INFO', status: 'ok', detail: process.version };
    }
    return {
      name: 'node-version',
      level: 'WARN',
      status: 'warn',
      detail: `${process.version} is below the documented minimum (node >= 22)`,
    };
  }

  // ── Log emission ──

  private emitBlock(report: ReadinessReport, trigger: 'boot' | 'manual'): void {
    const { summary, checks } = report;
    const banner = trigger === 'boot' ? 'Config readiness (boot)' : 'Config readiness (re-run)';
    const lines: string[] = [];
    lines.push('─────────────────────────────────────────────────────');
    lines.push(`${banner} — ok=${summary.ok} warn=${summary.warn} fail=${summary.fail}`);
    for (const check of checks) {
      const symbol = check.status === 'ok' ? '✓' : check.status === 'warn' ? '⚠' : '✗';
      const detail = check.detail ? ` — ${check.detail}` : '';
      lines.push(`  ${symbol} [${check.level}] ${check.name}${detail}`);
    }
    lines.push('─────────────────────────────────────────────────────');
    const message = lines.join('\n');
    // Choose log level by worst finding so the operator can spot the
    // block via grep on WARN/ERROR if anything needs attention.
    if (summary.fail > 0) this.logger.error(message);
    else if (summary.warn > 0) this.logger.warn(message);
    else this.logger.log(message);
  }
}
