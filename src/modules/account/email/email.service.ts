/**
 * EmailService — the only thing the rest of the account module (and,
 * once the account microservice exists, the rest of the world) should
 * inject when sending transactional mail.
 *
 * Vendor-blind: takes a template name + data + subject, renders, hands
 * off to the EmailAdapter. The adapter swap is one provider edit in
 * email.module.ts; this file does not change.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';

import { EMAIL_ADAPTER, EmailAdapter, SendResult } from './adapters/email-adapter.interface';
import { renderEmail } from './render';

export interface SendTemplatedArgs {
  to: string;
  subject: string;
  /** Template name without extension, e.g. 'email-verification'. */
  template: string;
  /** Variables passed to the EJS render context. */
  data: Record<string, unknown>;
  /** Optional plaintext fallback template name. Defaults to `${template}.txt` if present. */
  textTemplate?: string;
  /** Vendor analytics tag — typically the same as the template name. */
  tag?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(@Inject(EMAIL_ADAPTER) private readonly adapter: EmailAdapter) {}

  async sendTemplated(args: SendTemplatedArgs): Promise<SendResult> {
    const html = renderEmail(args.template, args.data);
    const result = await this.adapter.send({
      to: args.to,
      subject: args.subject,
      html,
      tag: args.tag ?? args.template,
    });
    this.logger.log(`Sent template=${args.template} to=${args.to} id=${result.id}`);
    return result;
  }
}
