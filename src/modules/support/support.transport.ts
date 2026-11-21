import { Injectable } from '@nestjs/common';

@Injectable()
export class SupportTransport {
  private async notifier() {
    const modulePath = process.env.SUPPORT_NOTIFY_MODULE;
    const topic = process.env.SUPPORT_NTFY_TOPIC;
    if (!modulePath?.startsWith('/') || !topic || !/^[a-zA-Z0-9_-]{1,64}$/.test(topic))
      throw new Error('support-alert-unconfigured');
    const ntfy = await import(modulePath);
    const config = ntfy.loadConfig();
    if (!config.token) throw new Error('support-alert-unconfigured');
    return { ntfy, config, topic };
  }
  async ready() {
    const base = process.env.AMS_BASE_URL;
    if (
      process.env.AMS_DISABLED === 'true' ||
      !base ||
      !process.env.AMS_SERVICE_TOKEN ||
      !['http:', 'https:'].includes(new URL(base).protocol)
    )
      throw new Error('support-mail-unconfigured');
    // Load protected publisher configuration without making any network request.
    await this.notifier();
  }
  async notify(reference: string, kind: 'received' | 'send_failed' | 'recovered') {
    // Reuse courthive-notify's authenticated VPC/Host-aware publisher; no credentials in case rows.
    const { ntfy, config, topic } = await this.notifier();
    const result = await ntfy.postMessage(config, {
      topic,
      title: 'TMX support',
      message: `${kind}: ${reference}`,
      priority: kind === 'send_failed' ? 4 : 3,
    });
    if (result.status !== 200) throw new Error('support-alert-rejected');
  }

  async send(to: string, reference: string, resolution: string, idempotencyKey: string) {
    const base = process.env.AMS_BASE_URL;
    const token = process.env.AMS_SERVICE_TOKEN;
    if (process.env.AMS_DISABLED === 'true' || !base || base === 'disabled' || !token)
      throw new Error('support-mail-unconfigured');
    const response = await fetch(`${base.replace(/\/$/, '')}/notifications/support-resolution`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-service-token': token },
      body: JSON.stringify({ to, reference, resolution, idempotencyKey }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('support-mail-rejected');
    const body: any = await response.json();
    if (body?.state !== 'accepted' || typeof body.id !== 'string' || !body.id || body.id.length > 200)
      throw new Error('support-mail-no-receipt');
    return body.id as string;
  }
}
