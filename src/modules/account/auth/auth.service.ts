import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { VALID_GLOBAL_ROLES, VALID_PROVIDER_ROLES } from 'src/common/constants/roles';
import { computeEffectiveConfig } from '@courthive/provider-config';
import { IdentityService } from '../identity/identity.service';
import { AuditService } from '../../audit/audit.service';
import { createUniqueKey } from './helpers/createUniqueKey';
import { EmailService } from '../email/email.service';
import { UsersService } from '../../users/users.service';
import { ConfigService } from '@nestjs/config';
import { hashPassword } from './helpers/hashPassword';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';

// constants and interfaces
import { SUCCESS } from 'src/common/constants/app';
import { PROVISIONER as PROVISIONER_ROLE, SUPER_ADMIN, PROVIDER_ADMIN } from 'src/common/constants/roles';
import {
  PROVIDER_STORAGE,
  type IProviderStorage,
  USER_STORAGE,
  type IUserStorage,
  USER_PROVISIONER_STORAGE,
  type IUserProvisionerStorage,
  USER_PROVIDER_STORAGE,
  type IUserProviderStorage,
  PROVISIONER_PROVIDER_STORAGE,
  type IProvisionerProviderStorage,
  AUTH_CODE_STORAGE,
  type IAuthCodeStorage,
} from 'src/storage/interfaces';
import { assertProviderEditor } from './helpers/assertProviderEditor';
import { buildUserContext } from './helpers/buildUserContext';
import { RefreshTokenService } from './refresh-token.service';
import type { UserContext } from './decorators/user-context.decorator';

const PASSWORD_RESET_TOKEN_TTL = '1h';
const ADMIN_ONBOARD_TOKEN_TTL = '7d';
const PASSWORD_RESET_PURPOSE = 'password-reset';

// Access-token (session JWT) lifetime. Short because TMX silently refreshes it
// via POST /auth/refresh using a long-lived rotating refresh token. 4h is a
// deliberate balance: long enough that a brief refresh failure on flaky
// tournament wifi doesn't immediately log officials out, short enough to bound
// the window of a leaked access token. See RefreshTokenService for the refresh
// side. Both the password-login path (signIn) and SSO handoff use this value.
const ACCESS_TOKEN_TTL = '4h';

// Magic-link login codes are short-lived and single-use. 15 minutes is long
// enough to receive the email and click, short enough to limit the window if
// the inbox is later compromised.
const MAGIC_LINK_TTL_MINUTES = 15;
const MAGIC_LINK_TTL_MS = MAGIC_LINK_TTL_MINUTES * 60 * 1000;
const MAGIC_LINK_PREFIX = 'mlk_';

// Conservative RFC-shaped email check — same regex as the migration backfill
// and IdentityService. Used to decide whether an admin-supplied contact_email
// is plausible enough to attempt delivery.
const EMAIL_REGEX = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

/**
 * Parse a short JWT-style duration ('1h', '7d', '30m', '90s', '2w') into
 * minutes for the email-body interpolation. Falls back to 60 if the shape
 * is unrecognised — the email still renders sensibly even if the number
 * is off, and the actual JWT verification uses the original string.
 */
function parseDurationToMinutes(duration: string): number {
  const match = /^(\d+)\s*([smhdw])$/i.exec(duration ?? '');
  if (!match) return 60;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  switch (unit) {
    case 's': return Math.max(1, Math.round(value / 60));
    case 'm': return value;
    case 'h': return value * 60;
    case 'd': return value * 60 * 24;
    case 'w': return value * 60 * 24 * 7;
    default:  return 60;
  }
}

const ALLOWED_ROLE_SET = new Set([...VALID_GLOBAL_ROLES, ...VALID_PROVIDER_ROLES, 'admin', 'official', 'director']);

// Global roles a non-SUPER_ADMIN editor may not GRANT via modifyUser.
// Removing them from a user is allowed; only escalation is gated.
const RESTRICTED_GRANT_ROLES = new Set<string>([SUPER_ADMIN, PROVISIONER_ROLE, 'developer']);

function assertNoPrivilegeEscalation(incomingRoles: unknown, currentRoles: unknown): void {
  if (!Array.isArray(incomingRoles)) return;
  const current: string[] = Array.isArray(currentRoles) ? (currentRoles as string[]) : [];
  const escalations = (incomingRoles as string[]).filter(
    (r) => RESTRICTED_GRANT_ROLES.has(r) && !current.includes(r),
  );
  if (escalations.length) {
    throw new ForbiddenException(`Only SUPER_ADMIN may grant role(s): ${escalations.join(', ')}`);
  }
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    @Inject(PROVIDER_STORAGE) private readonly providerStorage: IProviderStorage,
    @Inject(USER_STORAGE) private readonly userStorage: IUserStorage,
    @Inject(USER_PROVISIONER_STORAGE) private readonly userProvisionerStorage: IUserProvisionerStorage,
    @Inject(USER_PROVIDER_STORAGE) private readonly userProviderStorage: IUserProviderStorage,
    @Inject(PROVISIONER_PROVIDER_STORAGE)
    private readonly provisionerProviderStorage: IProvisionerProviderStorage,
    private readonly refreshTokenService: RefreshTokenService,
    @Inject(AUTH_CODE_STORAGE) private readonly authCodeStorage: IAuthCodeStorage,
    private readonly identityService: IdentityService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Authorize access to the Swagger explorer (/api) in production. Returns
   * true only for accounts that actually exercise the API — SUPER_ADMIN,
   * PROVISIONER-role users, or a PROVIDER_ADMIN of any provider — after a
   * bcrypt password check. SSO-only (passwordless) and unknown accounts are
   * rejected. Reuses the same role model as login (incl. the legacy
   * `admin` → PROVIDER_ADMIN shim via buildUserContext).
   */
  async canAccessApiDocs(email: string, clearTextPassword: string): Promise<boolean> {
    if (!email || !clearTextPassword) return false;
    let user: any;
    try {
      user = await this.usersService.findOne(email);
    } catch {
      return false;
    }
    if (!user?.password) return false;
    if (!(await bcrypt.compare(clearTextPassword, user.password))) return false;

    const roles: string[] = user.roles ?? [];
    if (roles.includes(SUPER_ADMIN) || roles.includes(PROVISIONER_ROLE)) return true;

    const ctx = await buildUserContext(user, {
      userProviderStorage: this.userProviderStorage,
      userProvisionerStorage: this.userProvisionerStorage,
      provisionerProviderStorage: this.provisionerProviderStorage,
    });
    return Object.values(ctx.providerRoles).includes(PROVIDER_ADMIN);
  }

  /**
   * Build the password-reset URL placed in the email body. Same shape
   * as the email-verification URL: lands on the admin-client public
   * route which extracts the token, shows a "Set new password" form,
   * POSTs to /auth/reset-password. POST-not-GET so link-previewers
   * can't accidentally consume the single-use token.
   */
  private buildResetUrl(token: string): string {
    const appConfig: any = this.configService.get('app');
    const base = String(appConfig?.baseUrl ?? process.env.APP_BASE_URL ?? '').replace(/\/+$/, '');
    if (!base) {
      throw new Error('APP_BASE_URL is not set; cannot generate password-reset link.');
    }
    return `${base}/admin/#/reset-password/${token}`;
  }

  async signIn(email: string, clearTextPassword: string, userAgent?: string) {
    if (!email) throw new UnauthorizedException();
    const user = await this.usersService.findOne(email);

    // SSO-only users have empty password — reject direct login
    if (user && !user.password) {
      throw new UnauthorizedException('This account uses SSO login. Please log in through your organization.');
    }

    const passwordMatch =
      user && (user.password === clearTextPassword || (await bcrypt.compare(clearTextPassword, user?.password)));
    if (!passwordMatch) throw new UnauthorizedException();

    // Admin-assigned passwords gate into a forced-change flow before a
    // full session is issued. Return a short-lived limited token whose
    // sole purpose is to authenticate the /auth/complete-first-login call.
    if (user.mustChangePassword) {
      const limitedToken = await this.jwtService.signAsync(
        { email: user.email, purpose: 'first-login-password-change' },
        { expiresIn: '5m' },
      );
      return { mustChangePassword: true, limitedToken };
    }

    const userDetails = await this.buildSessionPayload(user);
    return this.issueSession(userDetails, userAgent);
  }

  /**
   * Build the enriched, password-stripped JWT payload for a fully
   * authenticated user — provider config, provisioner context, and
   * multi-provider associations — and record last-access as a side effect.
   *
   * Shared by signIn and refreshSession so that a silently-refreshed access
   * token carries exactly the same claims as the one minted at login.
   */
  private async buildSessionPayload(user: any): Promise<any> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...userDetails } = user ?? {};
    const email = user.email;

    if (user.providerId) {
      const provider = await this.providerStorage.getProvider(user.providerId);
      userDetails.provider = provider;
      // Two-tier provider config: compute effective shape (caps ∩ settings)
      // and embed in the login response so TMX can apply it immediately.
      // Provider switcher / impersonation uses GET /api/provider/:id/effective-config
      // for runtime refetch — see Mentat/planning/TMX_PROVIDER_CONFIG_FEATURES.md.
      userDetails.activeProviderConfig = computeEffectiveConfig(
        provider?.providerConfigCaps,
        provider?.providerConfigSettings,
      );
    }

    // Track last access time for user and their provider. Failures are
    // non-fatal but must be visible — silent .catch() previously masked
    // case-mismatch and connection bugs that produced stale `last_access`
    // columns in the admin UI.
    //
    // Super-admin access never counts toward a provider's activity (they're
    // operating on every provider; crediting their home provider would be
    // misleading). User-level lastAccess always updates regardless of role.
    const isSuperAdmin = (user.roles ?? []).includes(SUPER_ADMIN);
    this.userStorage.updateLastAccess(email).catch((err: any) => {
      Logger.warn(`updateLastAccess(user=${email}) failed: ${err?.message ?? err}`, AuthService.name);
    });
    if (user.providerId && !isSuperAdmin) {
      const providerId = user.providerId;
      this.providerStorage.updateLastAccess(providerId).catch((err: any) => {
        Logger.warn(`updateLastAccess(provider=${providerId}) failed: ${err?.message ?? err}`, AuthService.name);
      });
    }

    // Phase 2A: PROVISIONER-role users carry their provisioner associations
    // in the JWT so the provisioner middleware can resolve them on every
    // request without a DB lookup. We also embed the managed providers (with
    // name/abbreviation) so TMX can offer them in the provider switcher and
    // grant provider-admin UI when one is active — server authz already
    // honors provisionerProviderIds (see checkTournamentAccess / checkProvider).
    if (user.userId && user.roles?.includes(PROVISIONER_ROLE)) {
      try {
        const provisionerIds = await this.userProvisionerStorage.findProvisionerIdsByUser(user.userId);
        userDetails.provisionerIds = provisionerIds;
        userDetails.provisionerProviders = await this.loadProvisionerProviders(provisionerIds);
      } catch (err) {
        Logger.warn(`Failed to load provisioner context for ${email}: ${(err as Error).message}`);
        userDetails.provisionerIds = [];
        userDetails.provisionerProviders = [];
      }
    }

    // Multi-provider session context. Load the user's full set of provider
    // associations from user_providers so TMX can surface them in the
    // provider switcher and resolve the active session provider. See
    // Mentat/planning/MULTI_PROVIDER_SESSION_CONTEXT.md for the design.
    //
    // `lastSelectedProviderId` was loaded with the user record (above). If
    // the persisted value no longer matches any current association (e.g.
    // the association was revoked between sessions), nullify it so the
    // TMX-side precedence falls through to the legacy provider_id default.
    if (user.userId) {
      try {
        const enriched = await this.userProviderStorage.findByUserIdEnriched(user.userId);
        const associations = enriched.map((row) => ({
          providerId: row.providerId,
          providerRole: row.providerRole,
          organisationName: row.organisationName,
          organisationAbbreviation: row.organisationAbbreviation,
        }));
        userDetails.providerAssociations = associations;
        if (userDetails.lastSelectedProviderId) {
          const stillValid = associations.some((a) => a.providerId === userDetails.lastSelectedProviderId);
          if (!stillValid) userDetails.lastSelectedProviderId = null;
        }
      } catch (err) {
        Logger.warn(`Failed to load providerAssociations for ${email}: ${(err as Error).message}`);
        userDetails.providerAssociations = [];
      }
    }

    return userDetails;
  }

  /**
   * Mint an access token (short-lived JWT) plus a long-lived rotating refresh
   * token for an already-built session payload. The refresh token's plaintext
   * is returned to the client exactly once; only its hash is persisted.
   */
  private async issueSession(
    userDetails: any,
    userAgent?: string,
  ): Promise<{ token: string; refreshToken: string }> {
    const token = await this.jwtService.signAsync(userDetails, { expiresIn: ACCESS_TOKEN_TTL });
    const userId = userDetails.userId ?? userDetails.user_id ?? userDetails.email;
    const refreshToken = await this.refreshTokenService.issue(userId, userDetails.email, userAgent);
    return { token, refreshToken };
  }

  /**
   * Exchange a valid refresh token for a fresh access token + rotated refresh
   * token. The presented refresh token is consumed (rotated) by
   * RefreshTokenService; reuse of an already-rotated token revokes the whole
   * family. The owning user is reloaded so the new access token reflects any
   * role/association changes since login. Public endpoint: the refresh token
   * is the credential.
   */
  async refreshSession(
    presentedRefreshToken: string,
    userAgent?: string,
  ): Promise<{ token: string; refreshToken: string }> {
    const rotated = await this.refreshTokenService.rotate(presentedRefreshToken, userAgent);
    const user = await this.usersService.findOne(rotated.email);
    if (!user) throw new UnauthorizedException();
    const userDetails = await this.buildSessionPayload(user);
    const token = await this.jwtService.signAsync(userDetails, { expiresIn: ACCESS_TOKEN_TTL });
    return { token, refreshToken: rotated.refreshToken };
  }

  /**
   * Revoke a presented refresh token (logout). Idempotent — always returns
   * SUCCESS so a client can clear local state without leaking whether the
   * token was known.
   */
  async logout(presentedRefreshToken: string) {
    await this.refreshTokenService.revoke(presentedRefreshToken);
    return { ...SUCCESS };
  }

  /**
   * Build the magic-link URL placed in the login email. Lands on the TMX
   * client's `#/magic/:code` route, which POSTs the code to
   * /auth/magic/consume. TMX lives under `${APP_BASE_URL}${TMX_URL}` (TMX_URL
   * defaults to `/tmx/`).
   */
  private buildMagicLinkUrl(code: string): string {
    const appConfig: any = this.configService.get('app');
    const base = String(appConfig?.baseUrl ?? process.env.APP_BASE_URL ?? '').replace(/\/+$/, '');
    if (!base) {
      throw new Error('APP_BASE_URL is not set; cannot generate magic-link.');
    }
    const tmxPath = `/${(process.env.TMX_URL ?? '/tmx/').replace(/^\/+|\/+$/g, '')}/`;
    return `${base}${tmxPath}#/magic/${code}`;
  }

  /**
   * Request a magic (passwordless) login link.
   *
   * Enumeration-defensive like forgotPassword: always returns `{ ok: true }`.
   * A link is sent only when ALL hold:
   *   - a user exists with this contact_email (case-insensitive)
   *   - email_verified_at is non-null (verified-contact-only policy)
   *   - the account has a password (SSO-only accounts must use their org login)
   * The code is single-use and expires in MAGIC_LINK_TTL_MINUTES.
   */
  async requestMagicLink(contactEmail: string): Promise<{ ok: true }> {
    const trimmed = (contactEmail ?? '').trim();
    if (!trimmed) return { ok: true };
    try {
      const user = await this.userStorage.findByContactEmail(trimmed);
      const eligible =
        user && user.emailVerifiedAt && user.userId && user.contactEmail && user.email && user.password;
      if (eligible) {
        const code = MAGIC_LINK_PREFIX + randomBytes(32).toString('base64url');
        const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS).toISOString();
        await this.authCodeStorage.setAccessCode(code, user.email, expiresAt);
        await this.emailService.sendTemplated({
          to: user.contactEmail,
          subject: 'Your CourtHive login link',
          template: 'magic-link',
          data: {
            firstName: user.firstName ?? '',
            magicLinkUrl: this.buildMagicLinkUrl(code),
            expiresInMinutes: MAGIC_LINK_TTL_MINUTES,
          },
          tag: 'magic-link',
        });
        Logger.log(`Sent magic-link to ${user.contactEmail} for user ${user.userId}`);
      } else {
        Logger.verbose(
          `requestMagicLink: no eligible recipient for "${trimmed}" (verified=${!!user?.emailVerifiedAt}, hasPassword=${!!user?.password})`,
        );
      }
    } catch (err) {
      // Log loudly but never change the response shape — that would leak
      // whether an address is a real, verified account.
      Logger.warn(`requestMagicLink silently swallowed error: ${(err as Error).message}`);
    }
    return { ok: true };
  }

  /**
   * Consume a magic-link code and issue a full session (access + refresh).
   * The code is atomically deleted (single-use) and rejected if expired.
   * SSO-only accounts are blocked — consistent with the request gate and the
   * signIn SSO-only rejection.
   */
  async consumeMagicLink(code: string, userAgent?: string): Promise<{ token: string; refreshToken: string }> {
    if (!code) throw new UnauthorizedException('Invalid or expired login link');
    const email = await this.authCodeStorage.consumeAccessCode(code);
    if (!email) throw new UnauthorizedException('Invalid or expired login link');

    const user = await this.usersService.findOne(email);
    // Block unknown and SSO-only (passwordless) accounts.
    if (!user || !user.password) throw new UnauthorizedException();

    const userDetails = await this.buildSessionPayload(user);
    return this.issueSession(userDetails, userAgent);
  }

  /**
   * Resolve the distinct set of providers a user's provisioners manage, each
   * enriched with organisation name/abbreviation for the TMX provider switcher.
   * Deduped across multiple provisioner associations.
   */
  private async loadProvisionerProviders(
    provisionerIds: string[],
  ): Promise<Array<{ providerId: string; organisationName: string; organisationAbbreviation: string }>> {
    const byProviderId = new Map<
      string,
      { providerId: string; organisationName: string; organisationAbbreviation: string }
    >();
    for (const provisionerId of provisionerIds) {
      const rows = await this.provisionerProviderStorage.findByProvisioner(provisionerId);
      for (const row of rows) {
        if (byProviderId.has(row.providerId)) continue;
        const provider = await this.providerStorage.getProvider(row.providerId);
        if (provider) {
          byProviderId.set(row.providerId, {
            providerId: row.providerId,
            organisationName: provider.organisationName,
            organisationAbbreviation: provider.organisationAbbreviation,
          });
        }
      }
    }
    return Array.from(byProviderId.values());
  }

  /**
   * PATCH /auth/me/last-selected-provider — persist the user's active
   * provider context across devices. Caller's userId comes from the
   * authenticated JWT. Validates `providerId` against `user_providers`;
   * rejects with `{ error: ... }` if the caller is not associated.
   * Pass `null` to clear.
   */
  async updateLastSelectedProvider(email: string, providerId: string | null) {
    if (!email) return { error: 'Authentication required' };
    if (providerId !== null) {
      const user = await this.usersService.findOne(email);
      if (!user?.userId) return { error: 'User not found' };
      const associations = await this.userProviderStorage.findByUserId(user.userId);
      const allowed = associations.some((a) => a.providerId === providerId);
      if (!allowed) return { error: 'Not authorised for that provider' };
    }
    return await this.userStorage.updateLastSelectedProviderId(email, providerId);
  }

  /**
   * Issue a password-reset (or admin-onboard) JWT for the given user
   * and send the matching template. Shared by:
   *   - forgotPassword: gated on emailVerifiedAt, 1h TTL, 'password-reset' template
   *   - adminCreateUser: ungated (admin vouches), 7d TTL, 'admin-created-account' template
   *
   * The token shape is identical (`purpose: 'password-reset'`) for both
   * call sites, so the same `/auth/reset-password` endpoint accepts
   * either. Centralising the token+send logic keeps the two flows in
   * sync without spreading JWT-claim shape across the service.
   */
  private async issueAndSendResetEmail(
    user: { userId: string; contactEmail: string; firstName?: string },
    opts: { expiresIn: string; template: 'password-reset-request' | 'admin-created-account'; subject: string; tag: string },
  ): Promise<void> {
    const token = await this.jwtService.signAsync(
      { userId: user.userId, contactEmail: user.contactEmail, purpose: PASSWORD_RESET_PURPOSE },
      { expiresIn: opts.expiresIn as any },
    );
    // Compute expiry in minutes for the template. Parses simple units
    // (s/m/h/d/w); falls back to the literal string if shape is unknown
    // (templates render it as a sentence either way).
    const expiresInMinutes = parseDurationToMinutes(opts.expiresIn);
    await this.emailService.sendTemplated({
      to: user.contactEmail,
      subject: opts.subject,
      template: opts.template,
      data: {
        firstName: user.firstName ?? '',
        resetUrl: this.buildResetUrl(token),
        expiresInMinutes,
      },
      tag: opts.tag,
    });
  }

  /**
   * Request a password reset.
   *
   * The contract is *enumeration-defensive*: this endpoint always
   * returns `{ ok: true }` regardless of whether the contact address
   * is registered, verified, or unknown. A caller probing the API
   * gets no signal about which contact emails are real accounts.
   *
   * Mail is sent only when ALL three are true:
   *   - a user exists with this contact_email (case-insensitive)
   *   - the user's email_verified_at is non-null
   *   - the user has a userId
   *
   * Any failure inside the send branch is logged and swallowed — the
   * response is `{ ok: true }` regardless so timing/error-shape can't
   * be used to enumerate either.
   */
  async forgotPassword(contactEmail: string): Promise<{ ok: true }> {
    const trimmed = (contactEmail ?? '').trim();
    if (!trimmed) return { ok: true };
    try {
      const user = await this.userStorage.findByContactEmail(trimmed);
      if (user && user.emailVerifiedAt && user.userId && user.contactEmail) {
        await this.issueAndSendResetEmail(
          { userId: user.userId, contactEmail: user.contactEmail, firstName: user.firstName },
          {
            expiresIn: PASSWORD_RESET_TOKEN_TTL,
            template: 'password-reset-request',
            subject: 'Reset your CourtHive password',
            tag: 'password-reset',
          },
        );
        Logger.log(`Sent password-reset mail to ${user.contactEmail} for user ${user.userId}`);
      } else {
        Logger.verbose(
          `forgotPassword: no eligible recipient for "${trimmed}" (verified=${!!user?.emailVerifiedAt})`,
        );
      }
    } catch (err) {
      // Log loudly so we can spot misdelivery / template bugs, but never
      // surface a different response shape to the caller — that would
      // leak whether an address is registered.
      Logger.warn(`forgotPassword silently swallowed error: ${(err as Error).message}`);
    }
    return { ok: true };
  }

  /**
   * Apply a password-reset token.
   *
   * Verifies the JWT (`purpose: 'password-reset'`), looks up the user
   * by userId, confirms the contact_email in the token still matches
   * the user's current contact_email (stale-token defense), writes the
   * new hashed password, and sends a confirmation email.
   *
   * Throws UnauthorizedException for token shape / expiry / purpose
   * problems and ForbiddenException for stale tokens whose contact
   * email has been changed since issue time.
   */
  async resetPassword(token: string, newPassword: string) {
    if (!token || !newPassword) return { error: 'token and newPassword are required' };
    let claims: any;
    try {
      claims = await this.jwtService.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired reset link');
    }
    if (claims?.purpose !== PASSWORD_RESET_PURPOSE || !claims?.userId) {
      throw new UnauthorizedException('Token is not a password-reset token');
    }

    const user = await this.userStorage.findByUserId(claims.userId);
    if (!user) throw new UnauthorizedException();

    // Stale-token defense: if contact_email was changed (which clears
    // email_verified_at via setContactEmail), reject. Same defense as
    // IdentityService.verifyEmailToken.
    if (
      claims.contactEmail &&
      String(user.contactEmail ?? '').toLowerCase() !== String(claims.contactEmail).toLowerCase()
    ) {
      throw new ForbiddenException('Contact email has changed since this reset link was issued');
    }

    const hashed = await hashPassword(newPassword);
    await this.userStorage.setPasswordByUserId(user.userId, hashed);

    // A password reset invalidates every existing session: kill all refresh
    // tokens so a leaked/forgotten credential can't keep a session alive.
    this.refreshTokenService.revokeAllForUser(user.userId).catch((err: any) => {
      Logger.warn(`revokeAllForUser(${user.userId}) after reset failed: ${err?.message ?? err}`, AuthService.name);
    });

    // Admin-onboard piggyback: a user who just clicked an email link and
    // set their password has proven they control the contact_email. If
    // it isn't already verified, stamp it now — this is how admin-created
    // accounts (B4) gain a verified address without a separate
    // verify-email click.
    if (!user.emailVerifiedAt) {
      try {
        await this.userStorage.markEmailVerified(user.userId);
      } catch (err) {
        Logger.warn(
          `Failed to stamp email_verified_at after reset for ${user.userId}: ${(err as Error).message}`,
        );
      }
    }

    // Security notification — fire-and-forget so a mail failure can't
    // roll back the password change. Logged at warn level so we notice.
    if (user.contactEmail) {
      this.emailService
        .sendTemplated({
          to: user.contactEmail,
          subject: 'Your CourtHive password was changed',
          template: 'password-reset-confirmation',
          data: {
            firstName: user.firstName ?? '',
            changedAt: new Date().toISOString(),
          },
          tag: 'password-reset-confirmation',
        })
        .catch((err) => {
          Logger.warn(
            `Failed to send password-reset confirmation to ${user.contactEmail}: ${(err as Error).message}`,
          );
        });
    }

    return { ...SUCCESS };
  }

  /**
   * Create a user directly with an assigned password. Replaces the
   * invite-by-URL flow. Returns the assigned password ONCE so the admin
   * can hand it to the new user; the DB stores only the bcrypt hash.
   *
   * Authorization:
   *   - SUPER_ADMIN: unrestricted, providerId optional
   *   - PROVIDER_ADMIN / PROVISIONER: providerId REQUIRED, scope enforced
   *     via assertProviderEditor()
   *
   * The created user is flagged `mustChangePassword=true`, which gates the
   * signIn path into a limited-token response that the client must satisfy
   * by POSTing to /auth/complete-first-login before receiving a full JWT.
   */
  async adminCreateUser(
    body: {
      email: string;
      password?: string;
      contactEmail?: string;
      providerId?: string;
      providerRole?: string;
      firstName?: string;
      lastName?: string;
      phone?: string;
      roles?: string[];
      permissions?: string[];
      services?: string[];
    },
    editor?: { userContext?: UserContext; provisionerIds?: string[] },
  ) {
    const email = (body?.email ?? '').toLowerCase().trim();
    if (!email) return { error: 'Email is required' };

    const requestedRoles: string[] = body?.roles ?? [];
    const invalidRoles = requestedRoles.filter((r) => !ALLOWED_ROLE_SET.has(r));
    if (invalidRoles.length) {
      return { error: `Invalid role(s): ${invalidRoles.join(', ')}` };
    }

    const providerRole: string =
      body?.providerRole === 'PROVIDER_ADMIN' ? 'PROVIDER_ADMIN' : 'DIRECTOR';

    const providerId = body?.providerId?.trim() || undefined;
    const editorContext = editor?.userContext;
    if (!editorContext?.isSuperAdmin) {
      if (!providerId) {
        throw new BadRequestException('providerId is required when the editor is not SUPER_ADMIN');
      }
      await assertProviderEditor({
        userContext: editorContext,
        providerId,
        provisionerIds: editor?.provisionerIds,
        provisionerProviderStorage: this.provisionerProviderStorage,
      });
    }

    const existing = await this.usersService.findOne(email);
    if (existing?.email) {
      throw new ConflictException(
        'A user with that email already exists. Use the existing-user association flow to add them to a provider.',
      );
    }

    // Decide upfront whether the admin gave us a deliverable contact_email.
    // When yes, the new user gets an onboard email with a "set your password"
    // link instead of a clipboard-handoff password. The link tokens reuse
    // the password-reset shape so the existing /auth/reset-password endpoint
    // handles them — see issueAndSendResetEmail().
    const contactEmailRaw = (body?.contactEmail ?? '').trim();
    const willEmail = !!contactEmailRaw && EMAIL_REGEX.test(contactEmailRaw);

    const supplied = (body?.password ?? '').trim();
    const password = supplied || createUniqueKey().slice(0, 12);

    const result: any = await this.usersService.create({
      firstName: body.firstName,
      lastName: body.lastName,
      phone: body.phone,
      roles: body.roles ?? [],
      permissions: body.permissions ?? [],
      services: body.services,
      email,
      password,
      mustChangePassword: true,
    } as any);
    if (result?.error) return result;

    const created = await this.usersService.findOne(email);
    const userId = created?.userId ?? created?.user_id;

    if (providerId && userId) {
      try {
        await this.userProviderStorage.upsert({ userId, providerId, providerRole });
      } catch (err) {
        Logger.warn(
          `Failed to upsert user_providers row for ${email}: ${(err as Error).message}`,
        );
      }
    }

    // Email-onboard path: stamp the contact_email (unverified), issue a
    // 7-day password-reset token, and send the welcoming template.
    // Successful click of that link verifies the address as a side effect
    // (see resetPassword above). The clipboard password is NOT returned
    // — the new user sets their own when they click the link.
    if (willEmail && userId) {
      try {
        await this.userStorage.setContactEmail(userId, contactEmailRaw);
        await this.issueAndSendResetEmail(
          { userId, contactEmail: contactEmailRaw, firstName: body.firstName },
          {
            expiresIn: ADMIN_ONBOARD_TOKEN_TTL,
            template: 'admin-created-account',
            subject: 'Welcome to CourtHive — set your password',
            tag: 'admin-onboard',
          },
        );
        Logger.log(`Sent admin-onboard mail to ${contactEmailRaw} for user ${userId}`);
        return {
          success: true,
          email,
          providerId,
          providerRole,
          mode: 'email-sent' as const,
          contactEmail: contactEmailRaw,
        };
      } catch (err) {
        // Fall through to the clipboard path so admin onboarding never
        // gets stuck on a transient mail failure. Log loudly so we notice.
        Logger.warn(
          `adminCreateUser email-onboard fell back to clipboard for ${email}: ${(err as Error).message}`,
        );
      }
    }

    return {
      success: true,
      email,
      password,
      providerId,
      providerRole,
      mode: 'password-returned' as const,
    };
  }

  /**
   * Complete the forced first-login password change. Called after signIn
   * returns `{ mustChangePassword: true, limitedToken }` for a user whose
   * password was assigned by an admin. The limited token's `purpose` claim
   * is verified, the new password is hashed and written, the flag is
   * cleared atomically, and a full JWT is issued via a fresh signIn.
   */
  async completeFirstLogin(limitedToken: string, newPassword: string) {
    if (!limitedToken || !newPassword) {
      return { error: 'limitedToken and newPassword are required' };
    }
    let claims: any;
    try {
      claims = await this.jwtService.verifyAsync(limitedToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired first-login token');
    }
    if (claims?.purpose !== 'first-login-password-change' || !claims?.email) {
      throw new UnauthorizedException('Token is not a first-login token');
    }
    const email = String(claims.email).toLowerCase().trim();
    const user = await this.usersService.findOne(email);
    if (!user) throw new UnauthorizedException();
    if (!user.mustChangePassword) {
      // Idempotent: if the flag was already cleared (e.g. user retried),
      // still attempt the password set so they aren't locked out, but
      // emit a warning.
      Logger.warn(`completeFirstLogin called for ${email} but mustChangePassword is already false`);
    }
    const hashed = await hashPassword(newPassword);
    await this.userStorage.completeFirstLogin(email, hashed);
    return await this.signIn(email, newPassword);
  }

  /**
   * Reset a user's password as an administrator.
   *
   * Authorization: SUPER_ADMIN unrestricted. Otherwise the editor must
   * have edit authority at *at least one* of the target user's
   * `user_providers` associations — i.e. PROVIDER_ADMIN or
   * PROVISIONER administering one of the target's providers.
   *
   * If the target user has no provider associations, only SUPER_ADMIN
   * can reset (the previous behavior).
   */
  async adminResetPassword(
    email: string,
    newPassword?: string,
    editor?: { userContext?: UserContext; provisionerIds?: string[] },
  ) {
    if (!email) return { error: 'Email is required' };
    const user = await this.usersService.findOne(email);
    if (!user) return { error: 'User not found' };

    const editorContext = editor?.userContext;
    if (!editorContext?.isSuperAdmin) {
      // Walk the target's provider associations until we find one the
      // editor has authority over. Pure SUPER_ADMIN short-circuits above.
      const targetUserId = user.userId ?? user.user_id;
      const targetRows = targetUserId
        ? await this.userProviderStorage.findByUserId(targetUserId)
        : [];
      let allowed = false;
      for (const row of targetRows) {
        try {
          await assertProviderEditor({
            userContext: editorContext,
            providerId: row.providerId,
            provisionerIds: editor?.provisionerIds,
            provisionerProviderStorage: this.provisionerProviderStorage,
          });
          allowed = true;
          break;
        } catch {
          // Try the next provider association.
        }
      }
      if (!allowed) {
        throw new ForbiddenException(
          'Not authorised to reset this user\u2019s password',
        );
      }
    }

    const password = newPassword || createUniqueKey().slice(0, 12);
    user.password = await hashPassword(password);
    await this.userStorage.update(email, user);

    // Admin reset invalidates the target's existing sessions.
    const targetUserId = user.userId ?? user.user_id;
    if (targetUserId) {
      this.refreshTokenService.revokeAllForUser(targetUserId).catch((err: any) => {
        Logger.warn(`revokeAllForUser(${targetUserId}) after admin reset failed: ${err?.message ?? err}`, AuthService.name);
      });
    }
    return { ...SUCCESS, password };
  }

  /**
   * Self-service password change for a logged-in user. Verifies the
   * current password before writing the new one. Returns 401 on a wrong
   * current-password to keep timing-attack surface flat with sign-in.
   */
  async changePassword(email: string, currentPassword: string, newPassword: string) {
    if (!email || !currentPassword || !newPassword) {
      return { error: 'Email, currentPassword, and newPassword are required' };
    }
    const user = await this.usersService.findOne(email);
    if (!user?.password) throw new UnauthorizedException();

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) throw new UnauthorizedException();

    const updated = { ...user, password: await hashPassword(newPassword) };
    await this.userStorage.update(email, updated);
    return { ...SUCCESS };
  }

  async modifyUser(
    params: { email: string; [key: string]: any },
    editor?: { userContext?: UserContext; provisionerIds?: string[] },
  ) {
    const { email, contactEmail, ...updates } = params;
    if (!email) return { error: 'Email is required' };

    const user = await this.usersService.findOne(email);
    if (!user) return { error: 'User not found' };

    // Authorization: SUPER_ADMIN unrestricted. Otherwise the editor must
    // have PROVIDER_ADMIN / PROVISIONER authority over at least one of
    // the target user's provider associations — same walk used by
    // adminResetPassword (auth.service.ts:810). A target with zero
    // provider rows can only be modified by SUPER_ADMIN.
    const editorContext = editor?.userContext;
    if (!editorContext?.isSuperAdmin) {
      await this.assertModifyUserAuthority(user, editor);
      assertNoPrivilegeEscalation(updates.roles, user.roles);
    }

    // contact_email and email_verified_at live in dedicated columns and must
    // be written via setContactEmail, which atomically CLEARS verification
    // on change. Doing it through the generic `update` blob would either
    // miss the verified-clear or write to the wrong column. Only routes
    // through setContactEmail when the value actually differs (case-
    // insensitive) so re-saving the modal without touching this field is
    // a no-op and verified status is preserved.
    const contactEmailChange = this.resolveContactEmailChange(user, contactEmail);
    if (contactEmailChange === 'invalid') {
      return { error: 'contactEmail is not a valid email address' };
    }

    const merged = { ...user, ...updates };
    await this.userStorage.update(email, merged);

    let responseContactEmail = user.contactEmail ?? user.contact_email;
    let responseEmailVerifiedAt = user.emailVerifiedAt ?? user.email_verified_at ?? null;
    if (contactEmailChange !== null) {
      const userId = user.userId ?? user.user_id;
      if (userId) {
        await this.userStorage.setContactEmail(userId, contactEmailChange);
        responseContactEmail = contactEmailChange;
        responseEmailVerifiedAt = null;

        // Audit BEFORE the mail attempt — the change is the auditable
        // event regardless of whether SMTP succeeds. Fail-soft inside
        // the audit service.
        await this.auditService.recordContactEmailChanged({
          targetUserId: userId,
          targetEmail: email,
          actorUserId: editor?.userContext?.userId,
          actorEmail: editor?.userContext?.email,
          oldContactEmail: user.contactEmail ?? user.contact_email ?? null,
          newContactEmail: contactEmailChange,
          source: 'admin',
        });

        // Fire the verification mail when the admin sets a non-empty
        // address. IdentityService.resendVerification re-reads the user
        // row, so it picks up the contact_email we just wrote and skips
        // when the field was cleared (the `no_contact_email` branch).
        // Failures here are logged but don't fail the modify — the admin
        // can re-trigger via the explicit resend endpoint.
        if (contactEmailChange) {
          try {
            await this.identityService.resendVerification({
              userId,
              email,
              firstName: user.firstName,
            });
          } catch (err) {
            Logger.warn(
              `modifyUser: verification mail to ${contactEmailChange} for ${email} failed: ${(err as Error).message}`,
              AuthService.name,
            );
          }
        }
      }
    }

    const { password: _, ...safeUser } = merged; // eslint-disable-line @typescript-eslint/no-unused-vars
    return {
      success: true,
      user: { ...safeUser, contactEmail: responseContactEmail, emailVerifiedAt: responseEmailVerifiedAt },
    };
  }

  /**
   * Walks the target user's provider associations and throws
   * ForbiddenException if the editor has authority over none of them.
   * Mirrors the loop in adminResetPassword (auth.service.ts:810).
   */
  private async assertModifyUserAuthority(
    user: any,
    editor?: { userContext?: UserContext; provisionerIds?: string[] },
  ): Promise<void> {
    const targetUserId = user.userId ?? user.user_id;
    const targetRows = targetUserId
      ? await this.userProviderStorage.findByUserId(targetUserId)
      : [];
    for (const row of targetRows) {
      try {
        await assertProviderEditor({
          userContext: editor?.userContext,
          providerId: row.providerId,
          provisionerIds: editor?.provisionerIds,
          provisionerProviderStorage: this.provisionerProviderStorage,
        });
        return;
      } catch {
        // Try the next provider association.
      }
    }
    throw new ForbiddenException('Not authorised to modify this user');
  }

  /**
   * Returns the normalized new contact_email if the admin actually changed
   * it, `null` if the field was omitted or matches the current value
   * (case-insensitive), or `'invalid'` if the value is non-empty but does
   * not look like an RFC-shaped address. Empty string is treated as
   * "clear contact_email" — caller hands it to setContactEmail unchanged.
   */
  private resolveContactEmailChange(
    user: any,
    incoming: string | undefined,
  ): string | null | 'invalid' {
    if (incoming === undefined) return null;
    const trimmed = (incoming ?? '').trim();
    const current = (user.contactEmail ?? user.contact_email ?? '').trim();
    if (trimmed.toLowerCase() === current.toLowerCase()) return null;
    if (trimmed && !EMAIL_REGEX.test(trimmed)) return 'invalid';
    return trimmed;
  }

  async removeUser(params: any) {
    return await this.usersService.remove(params.email);
  }

  async getUsers() {
    return await this.usersService.findAll();
  }

  async decode(token: string) {
    try {
      return await this.jwtService.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Incorrect auth token.');
    }
  }
}
