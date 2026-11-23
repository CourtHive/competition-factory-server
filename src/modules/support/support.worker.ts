import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { USER_STORAGE, type IUserStorage } from 'src/storage/interfaces';
import { SupportTransport } from './support.transport';
import { SupportStore } from './support.store';
import { SUPER_ADMIN } from 'src/common/constants/roles';
import type { PoolClient } from 'pg';

@Injectable()
export class SupportWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SupportWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private active?: Promise<void>;
  // Process-local DB-availability telemetry resets on restart; an unavailable DB cannot store it.
  // Durable case/send/alert counters live in Postgres; ERROR logs reach the existing PM2 watcher.
  private failures = 0;
  constructor(
    private readonly store: SupportStore,
    private readonly transport: SupportTransport,
    @Inject(USER_STORAGE) private readonly users: IUserStorage,
  ) {}

  async onApplicationBootstrap() {
    if (process.env.SUPPORT_DISPATCH_ENABLED === 'true') {
      if (
        !process.env.AMS_BASE_URL ||
        !process.env.AMS_SERVICE_TOKEN ||
        !process.env.SUPPORT_NOTIFY_MODULE ||
        !process.env.SUPPORT_NTFY_TOPIC
      )
        throw new Error('Support reporting requires AMS and courthive-notify configuration');
      await this.transport.ready();
      if (!process.env.SUPPORT_INBOX_OWNER_ID) this.logger.error('support-inbox-mail-owner-unconfigured');
    }
    // One bounded sweep/minute, no tournament polling. Work and retry counters live in Postgres, not this timer.
    this.timer = setInterval(() => {
      void this.tick();
    }, 60_000);
    this.timer.unref();
    void this.tick();
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.active;
  }
  tick(): Promise<void> {
    if (this.active) return this.active;
    this.active = this.sweep()
      .catch(() => {
        this.failures++;
        if (this.failures === 1 || this.failures % 50 === 0 || Number.isInteger(Math.log10(this.failures)))
          this.logger.error(`support-worker-failed count=${this.failures}`);
      })
      .finally(() => {
        this.active = undefined;
      });
    return this.active;
  }
  private async sweep() {
    await this.store.purge();
    if (process.env.SUPPORT_DISPATCH_ENABLED === 'true') {
      for (let i = 0; i < 10; i++) if (!(await this.processOne())) break;
    }
    if (this.failures) {
      this.logger.warn(`support-worker-recovered failures=${this.failures}`);
      this.failures = 0;
    }
  }
  private async processOne() {
    const client = await this.store.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT * FROM support_cases WHERE expires_at > now() + interval '20 seconds' AND
        ((alert_state='pending' AND alert_after <= now()) OR (send_state IN ('pending','awaiting_contact') AND send_after <= now())
        OR (inbox_mail_state='pending' AND inbox_mail_after <= now() AND $1::boolean))
        ORDER BY submitted_at FOR UPDATE SKIP LOCKED LIMIT 1`,
        [!!process.env.SUPPORT_INBOX_OWNER_ID],
      );
      const row = rows[0];
      if (!row) {
        await client.query('COMMIT');
        return false;
      }
      if (row.alert_state === 'pending' && new Date(row.alert_after).getTime() <= Date.now()) {
        try {
          await this.transport.notify(row.reference, row.alert_kind);
          await client.query(`UPDATE support_cases SET alert_state='sent' WHERE reference=$1`, [row.reference]);
        } catch {
          const attempts = Number(row.alert_attempts) + 1;
          if (attempts === 1 || attempts % 50 === 0 || Number.isInteger(Math.log10(attempts)))
            this.logger.warn(`support-alert-failed ${row.reference} count=${attempts}`);
          await client.query(
            `UPDATE support_cases SET alert_attempts=alert_attempts+1,
            alert_after=now()+interval '5 minutes' WHERE reference=$1`,
            [row.reference],
          );
        }
      }
      let committed = false;
      if (['pending', 'awaiting_contact'].includes(row.send_state) && new Date(row.send_after).getTime() <= Date.now())
        committed = await this.send(client, row);
      if (
        !committed &&
        row.inbox_mail_state === 'pending' &&
        new Date(row.inbox_mail_after).getTime() <= Date.now() &&
        process.env.SUPPORT_INBOX_OWNER_ID
      )
        committed = await this.notifyInbox(client, row, process.env.SUPPORT_INBOX_OWNER_ID);
      if (!committed) await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  private async notifyInbox(client: PoolClient, row: any, ownerId: string) {
    const owner = await this.users.findByUserId(ownerId);
    const to = owner?.roles?.includes(SUPER_ADMIN) && owner.emailVerifiedAt ? owner.contactEmail : undefined;
    // Never reuse a provider idempotency key with another recipient or outside its retry window.
    if (
      row.inbox_mail_started_at &&
      (to !== row.inbox_mail_to || Date.now() - new Date(row.inbox_mail_started_at).getTime() >= 3_600_000)
    ) {
      await client.query("UPDATE support_cases SET inbox_mail_state='failed' WHERE reference=$1", [row.reference]);
      this.logger.error(`support-inbox-mail-needs-review ${row.reference}`);
      return false;
    }
    if (!to) {
      await client.query("UPDATE support_cases SET inbox_mail_after=now()+interval '10 minutes' WHERE reference=$1", [
        row.reference,
      ]);
      this.logger.warn(`support-inbox-mail-awaiting-owner-contact ${row.reference}`);
      return false;
    }
    const intent = await client.query(
      `UPDATE support_cases SET inbox_mail_to=$2,
      inbox_mail_started_at=COALESCE(inbox_mail_started_at,now()), inbox_mail_after=now()+interval '2 minutes'
      WHERE reference=$1 AND expires_at > clock_timestamp()+interval '15 seconds' RETURNING reference`,
      [row.reference, to],
    );
    if (!intent.rows.length) return false;
    await client.query('COMMIT');
    try {
      await this.transport.notifyInbox(to, row.reference);
    } catch {
      this.logger.warn(`support-inbox-mail-retry ${row.reference}`);
      return true;
    }
    await client.query("UPDATE support_cases SET inbox_mail_state='accepted' WHERE reference=$1", [row.reference]);
    return true;
  }

  private async send(client: PoolClient, row: any) {
    const user = await this.users.findByUserId(row.reporter_id);
    if (!user?.contactEmail || !user?.emailVerifiedAt) {
      await client.query(
        `UPDATE support_cases SET send_state='awaiting_contact', send_after=now()+interval '5 minutes' WHERE reference=$1`,
        [row.reference],
      );
      return false;
    }
    // Never silently change the recipient of an ambiguous retry or retry outside the provider's idempotency window.
    if (
      (row.send_email && row.send_email !== user.contactEmail) ||
      row.send_attempts >= 5 ||
      (row.send_started_at && Date.now() - new Date(row.send_started_at).getTime() > 3_600_000)
    ) {
      await this.fail(client, row.reference, 'manual_review_required');
      return false;
    }
    // Commit the immutable recipient/key/start time BEFORE I/O. A crash cannot reset the retry window.
    // The durable two-minute lease exceeds the bounded transport call and prevents concurrent sends.
    const intent = await client.query(
      `UPDATE support_cases SET send_email=$2, send_started_at=COALESCE(send_started_at,now()),
      send_attempts=send_attempts+1, send_after=now()+interval '2 minutes'
      WHERE reference=$1 AND expires_at > clock_timestamp()+interval '15 seconds' RETURNING reference`,
      [row.reference, user.contactEmail],
    );
    if (!intent.rows.length) return false;
    await client.query('COMMIT');
    try {
      const receipt = await this.transport.send(user.contactEmail, row.reference, row.resolution, row.resolution_key);
      await client.query(
        `UPDATE support_cases SET send_state='accepted', provider_receipt=$2, send_error=NULL WHERE reference=$1`,
        [row.reference, receipt],
      );
      if (row.send_attempts) await this.queueAlert(client, row.reference, 'recovered');
    } catch {
      const terminal = row.send_attempts >= 4;
      await client.query(
        `UPDATE support_cases SET send_state=$2, send_error='transport_failed', send_after=now()+interval '5 minutes'
        WHERE reference=$1`,
        [row.reference, terminal ? 'failed' : 'pending'],
      );
      if (!row.send_attempts || terminal) await this.queueAlert(client, row.reference, 'send_failed');
    }
    return true;
  }
  private async fail(client: PoolClient, reference: string, code: string) {
    await client.query(`UPDATE support_cases SET send_state='failed', send_error=$2 WHERE reference=$1`, [
      reference,
      code,
    ]);
    await this.queueAlert(client, reference, 'send_failed');
  }
  private async queueAlert(client: PoolClient, reference: string, kind: string) {
    this.logger.warn(`support-${kind} ${reference}`);
    await client.query(
      `UPDATE support_cases SET alert_kind=$2, alert_state='pending', alert_attempts=0,
      alert_after=now() WHERE reference=$1`,
      [reference, kind],
    );
  }
}
