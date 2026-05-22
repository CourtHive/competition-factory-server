/**
 * Vendor-agnostic email adapter.
 *
 * EmailService is the public surface; the adapter is swappable without
 * the service code changing. Today: ResendAdapter. Tomorrow: drop in
 * postmark.adapter.ts / ses.adapter.ts behind the same interface, flip
 * the factory provider in email.module.ts, no other code changes.
 */
export const EMAIL_ADAPTER = Symbol('EMAIL_ADAPTER');

export interface SendArgs {
  to: string;
  subject: string;
  html: string;
  /** Optional plaintext fallback. Best practice for deliverability; some clients prefer it. */
  text?: string;
  /** Vendor-tag for analytics / segmentation (e.g. 'password-reset', 'email-verification'). */
  tag?: string;
}

export interface SendResult {
  /** Vendor-assigned message id for trace correlation. */
  id: string;
}

export interface EmailAdapter {
  send(args: SendArgs): Promise<SendResult>;
}
