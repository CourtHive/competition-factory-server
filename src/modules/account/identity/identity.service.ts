/**
 * IdentityService — owns the separation between `users.email` (the LOGIN
 * identifier, historically often a non-email string) and
 * `users.contact_email` (the verified mailbox we send password recovery
 * + account notices to).
 *
 * Three operations:
 *
 *   - setContactEmail(userId, address) — validates RFC, stamps the new
 *     address, clears `email_verified_at`, fires a verification email
 *     with a short-lived signed token (purpose: 'email-verification').
 *
 *   - resendVerification(userId) — re-sends the verification email if
 *     the user has a contact_email pending. No-op if already verified.
 *
 *   - verifyEmailToken(token, newPassword?) — accepts the token from
 *     the link, marks the row verified.
 *
 * The token is a short-lived JWT carrying `purpose:
 * 'email-verification'`; the auth.middleware rejects tokens carrying a
 * `purpose` claim at normal endpoints so this token can't be used to
 * authenticate anything else.
 */
import { ForbiddenException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

import { USER_STORAGE, type IUserStorage } from 'src/storage/interfaces';
import { EmailService } from '../email/email.service';

const VERIFICATION_TOKEN_TTL = '24h';
const VERIFICATION_TOKEN_TTL_MINUTES = 24 * 60;
const EMAIL_VERIFICATION_PURPOSE = 'email-verification';

// Conservative RFC-shaped check — same regex as the migration backfill.
// Strict enough to reject obvious garbage (no `@`, `user@@host`, etc.)
// without trying to be a full RFC 5322 parser. The verification email
// itself is the real test of deliverability.
const EMAIL_REGEX = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    @Inject(USER_STORAGE) private readonly userStorage: IUserStorage,
  ) {}

  /**
   * Build the verification URL placed in the email body. Lands on the
   * admin-client public route which extracts the token, shows a Verify
   * button, and POSTs to /auth/verify-email. We deliberately avoid a
   * raw GET so link-previewers (Slack, Discord, anti-spam scanners)
   * don't accidentally consume the single-use token.
   */
  private buildVerifyUrl(token: string): string {
    const appConfig: any = this.configService.get('app');
    const base = String(appConfig?.baseUrl ?? process.env.APP_BASE_URL ?? '').replace(/\/+$/, '');
    if (!base) {
      throw new Error('APP_BASE_URL is not set; cannot generate verification link.');
    }
    return `${base}/admin/#/verify-email/${token}`;
  }

  async setContactEmail(
    user: { userId: string; firstName?: string },
    contactEmail: string,
  ): Promise<{ success: true; status: 'pending_verification'; contactEmail: string } | { error: string }> {
    const trimmed = (contactEmail ?? '').trim();
    if (!trimmed) return { error: 'contactEmail is required' };
    if (!EMAIL_REGEX.test(trimmed)) return { error: 'Not a valid email address' };
    if (!user?.userId) return { error: 'Authentication required' };

    await this.userStorage.setContactEmail(user.userId, trimmed);

    const token = await this.jwtService.signAsync(
      { userId: user.userId, contactEmail: trimmed, purpose: EMAIL_VERIFICATION_PURPOSE },
      { expiresIn: VERIFICATION_TOKEN_TTL },
    );

    await this.emailService.sendTemplated({
      to: trimmed,
      subject: 'Verify your email — CourtHive',
      template: 'email-verification',
      data: {
        firstName: user.firstName ?? '',
        email: trimmed,
        verifyUrl: this.buildVerifyUrl(token),
        expiresInMinutes: VERIFICATION_TOKEN_TTL_MINUTES,
      },
      tag: 'email-verification',
    });

    this.logger.log(`Sent verification mail to ${trimmed} for user ${user.userId}`);
    return { success: true, status: 'pending_verification', contactEmail: trimmed };
  }

  async resendVerification(
    user: { userId: string; firstName?: string; email: string },
  ): Promise<{ success: true; status: 'pending_verification' | 'already_verified' | 'no_contact_email' }> {
    if (!user?.userId) throw new UnauthorizedException();
    const record = await this.userStorage.findOne(user.email);
    if (!record?.contactEmail) return { success: true, status: 'no_contact_email' };
    if (record.emailVerifiedAt) return { success: true, status: 'already_verified' };

    const token = await this.jwtService.signAsync(
      { userId: user.userId, contactEmail: record.contactEmail, purpose: EMAIL_VERIFICATION_PURPOSE },
      { expiresIn: VERIFICATION_TOKEN_TTL },
    );

    await this.emailService.sendTemplated({
      to: record.contactEmail,
      subject: 'Verify your email — CourtHive',
      template: 'email-verification',
      data: {
        firstName: user.firstName ?? record.firstName ?? '',
        email: record.contactEmail,
        verifyUrl: this.buildVerifyUrl(token),
        expiresInMinutes: VERIFICATION_TOKEN_TTL_MINUTES,
      },
      tag: 'email-verification',
    });

    this.logger.log(`Re-sent verification mail to ${record.contactEmail} for user ${user.userId}`);
    return { success: true, status: 'pending_verification' };
  }

  async verifyEmailToken(token: string): Promise<{ success: true; contactEmail: string }> {
    if (!token) throw new UnauthorizedException('Missing token');
    let claims: any;
    try {
      claims = await this.jwtService.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired verification token');
    }
    if (claims?.purpose !== EMAIL_VERIFICATION_PURPOSE || !claims?.userId || !claims?.contactEmail) {
      throw new UnauthorizedException('Token is not a verification token');
    }

    // Defensive: confirm the contact_email on the user record still matches
    // the one in the token. If the user changed their contact_email after
    // the token was issued, this stale token must not verify the new
    // address — re-verification has to start over.
    const record = await this.userStorage.findOne(claims?.email ?? '');  // best-effort by email
    // Most common path: look up by contact_email which is unique-ish.
    const byContact = record ?? (await this.userStorage.findByContactEmail(claims.contactEmail));
    if (!byContact || byContact.userId !== claims.userId) {
      throw new ForbiddenException('Verification token does not match the current contact address');
    }
    if (byContact.contactEmail?.toLowerCase() !== String(claims.contactEmail).toLowerCase()) {
      throw new ForbiddenException('Contact email has changed since this link was issued');
    }

    await this.userStorage.markEmailVerified(claims.userId);
    this.logger.log(`Verified contact email ${claims.contactEmail} for user ${claims.userId}`);
    return { success: true, contactEmail: claims.contactEmail };
  }
}
