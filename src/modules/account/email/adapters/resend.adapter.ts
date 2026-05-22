/**
 * Resend adapter — initial implementation of the EmailAdapter contract.
 *
 * Why dynamic require: the `resend` npm package is added to package.json
 * by the same PR that adds this file, but agents in this repo cannot run
 * `pnpm install` (see CourtHive CLAUDE.md). Until a developer runs the
 * install, the package isn't in node_modules. A static `import` would
 * fail at compile time; require() inside the constructor lets the file
 * compile cleanly and surfaces a useful error only when send() is
 * actually called without the dep present.
 *
 * Once `resend` is installed, the dynamic require resolves at first
 * call, caches the client, and behaves like a normal SDK import for the
 * rest of process lifetime.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EmailAdapter, SendArgs, SendResult } from './email-adapter.interface';

@Injectable()
export class ResendAdapter implements EmailAdapter {
  private readonly logger = new Logger(ResendAdapter.name);
  private client: any;
  private readonly from: string;

  constructor(config: ConfigService) {
    const emailConfig = config.get('email') ?? {};
    this.from = emailConfig.from || process.env.EMAIL_FROM || '';
    if (!this.from) {
      this.logger.warn(
        'EMAIL_FROM is not set — outbound mail will be rejected by the provider. Set it in .env before B2 ships.',
      );
    }
  }

  private getClient(): any {
    if (this.client) return this.client;
    let ResendCtor: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ResendCtor = require('resend').Resend;
    } catch (err) {
      throw new Error(
        "Resend SDK is not installed. Run `pnpm install` in competition-factory-server " +
        "to pick up the new `resend` dependency, then restart the server.",
      );
    }
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not set');
    }
    this.client = new ResendCtor(apiKey);
    return this.client;
  }

  async send(args: SendArgs): Promise<SendResult> {
    const client = this.getClient();
    const { data, error } = await client.emails.send({
      from: this.from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
      tags: args.tag ? [{ name: 'category', value: args.tag }] : undefined,
    });
    if (error) {
      this.logger.error(`Resend send failed: ${JSON.stringify(error)}`);
      throw new Error(`Resend send failed: ${error.message ?? 'unknown error'}`);
    }
    return { id: data?.id ?? '' };
  }
}
