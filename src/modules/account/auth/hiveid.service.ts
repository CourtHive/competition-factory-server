/**
 * HiveIDService — public-facing sibling to AuthService.
 *
 * Owns the `/auth/hiveid/*` flows: signup, verify-existing, magic-link
 * (request + consume), and the HiveID-side `me` projection. Composes the
 * existing PersonsClient + AuthService + EmailService rather than
 * duplicating their logic, so admin-side login flows are untouched.
 *
 * Tokens minted here carry the `aud: 'hiveid'` claim (or
 * `aud: ['admin', 'hiveid']` for an existing admin who has verified their
 * HiveID identity). See AuthGuard + the Audience decorator for the
 * verification side.
 */
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';

import {
  AUTH_CODE_STORAGE,
  type IAuthCodeStorage,
  USER_STORAGE,
  type IUserStorage,
} from 'src/storage/interfaces';
import { ConfigService } from '@nestjs/config';
import { HIVEID_MAGIC_LINK_PREFIX } from './hiveid.constants';
import { PersonsClient, type PersonFragmentInput } from '../persons/persons-client.service';
import type { HiveIDSignupDto } from './dto/hiveidSignup.dto';
import { IdentityService } from '../identity/identity.service';
import { EmailService } from '../email/email.service';
import { UsersService } from '../../users/users.service';
import { AuthService } from './auth.service';

const HIVEID_MAGIC_LINK_TTL_MINUTES = 15;
const HIVEID_MAGIC_LINK_TTL_MS = HIVEID_MAGIC_LINK_TTL_MINUTES * 60 * 1000;

// The SPLIT tournament methods (getMyParticipations / getClaimableForTournament /
// claimParticipant) plus their participant helpers + row/candidate types moved to
// HiveIDTournamentService (tournament-auth) so they survive the Phase-3 drop of
// this MOVE service — they read CFS tournament records and stay on CFS.

@Injectable()
export class HiveIDService {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly emailService: EmailService,
    private readonly identityService: IdentityService,
    private readonly configService: ConfigService,
    private readonly personsClient: PersonsClient,
    @Inject(USER_STORAGE) private readonly userStorage: IUserStorage,
    @Inject(AUTH_CODE_STORAGE) private readonly authCodeStorage: IAuthCodeStorage,
  ) {}

  /**
   * POST /auth/hiveid/signup — create a brand-new HiveID user.
   *
   * If the email already belongs to an admin user, throw 409 pointing the
   * caller at `/auth/hiveid/verify-existing` (Tier-2.12 — never create a
   * shadow row alongside an existing admin without proving control of the
   * password first).
   *
   * Otherwise resolve via courthive-persons, persist the canonical link,
   * and mint a `hiveid`-audience session. Brand-new users get a random
   * unrecoverable password — they authenticate via magic-link.
   */
  async signup(body: HiveIDSignupDto, userAgent?: string) {
    const email = (body?.email ?? '').toLowerCase().trim();
    if (!email) throw new BadRequestException('email is required');
    if (!body?.firstName?.trim() || !body?.lastName?.trim()) {
      throw new BadRequestException('firstName and lastName are required');
    }

    const existing = await this.usersService.findOne(email);
    if (existing?.email) {
      throw new ConflictException({
        code: 'EXISTING_USER',
        message:
          'An account with that email already exists. Verify your password to add a HiveID to it.',
        redirect: '/auth/hiveid/verify-existing',
      });
    }

    const federationOtherIds = (body.federationIds ?? [])
      .filter((f) => f?.provider && f?.externalId)
      .map((f) => ({ provider: f.provider, externalId: f.externalId }));

    // A provider context (the registering tournament's provider, carried from the
    // public registration page) anchors a brand-new person to that tenant via a
    // synthesized provider-scoped id — the only otherId a fresh public person can
    // supply, and the ≥1-personOtherIds anchor courthive-persons requires to MINT.
    // `resolve` still dedupes on name+DOB+sex FIRST, so a returning person is
    // matched (and this alias backfilled) rather than duplicated. (Decision #5.)
    const provider = body.provider?.trim();
    const syntheticOtherId = provider ? [{ provider, externalId: randomUUID() }] : [];

    const fragment: PersonFragmentInput = {
      standardGivenName: body.firstName.trim(),
      standardFamilyName: body.lastName.trim(),
      birthDate: body.birthDate?.trim() || undefined,
      sex: body.sex?.trim() || undefined,
      personOtherIds: [...federationOtherIds, ...syntheticOtherId],
      source: 'cfs-hiveid-signup',
    };

    const resolved = await this.personsClient.resolve(fragment);

    if (resolved.status === 'incomplete') {
      throw new HttpException(
        { status: 'incomplete', missingFields: resolved.missingFields ?? [] },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (resolved.status === 'candidate') {
      return { status: 'candidate' as const, candidates: resolved.candidates ?? [] };
    }
    const personId = resolved.personId;
    const personRevision = resolved.personRevision;
    if (!personId || personRevision == null) {
      throw new HttpException(
        { status: 'incomplete', missingFields: ['personId'] },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // Pull canonical fields for the survivor so the freshly-linked user
    // row carries the standardised name/dob/sex/nationality from the
    // registry, not the form-supplied free-text.
    const survivor = await this.personsClient.getById(personId);
    const cached = {
      standardFamilyName: survivor?.person?.standardFamilyName ?? body.lastName.trim(),
      standardGivenName: survivor?.person?.standardGivenName ?? body.firstName.trim(),
      birthDate: survivor?.person?.birthDate ?? null,
      sex: survivor?.person?.sex ?? null,
      nationalityCode: survivor?.person?.nationalityCode ?? null,
    };

    const randomPassword = randomBytes(32).toString('base64url');
    const created = await this.usersService.create({
      email,
      password: randomPassword,
      firstName: body.firstName.trim(),
      lastName: body.lastName.trim(),
      roles: [],
    });
    if ((created as any)?.error) {
      return created;
    }

    const fresh = await this.usersService.findOne(email);
    const userId = fresh?.userId ?? fresh?.user_id;
    if (!userId) {
      throw new HttpException('failed to provision user row', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    try {
      await this.userStorage.setContactEmail(userId, email);
    } catch (err) {
      Logger.warn(
        `hiveid signup: setContactEmail for ${email} failed: ${(err as Error).message}`,
        HiveIDService.name,
      );
    }
    await this.userStorage.setPersonLink(userId, { personId, personRevision, cached });

    // Fire the email-verification mail (public landing → courthive-public).
    // Best-effort: a mail failure must NOT block signup — the user already has
    // a session and can resend from /#/me. Verified status gates official
    // scorer nomination (Phase D), not basic access or crowd scoring.
    try {
      await this.identityService.resendVerification(
        { userId, email, firstName: cached.standardGivenName ?? body.firstName.trim() },
        { landing: 'public' },
      );
    } catch (err) {
      Logger.warn(
        `hiveid signup: verification email for ${email} failed: ${(err as Error).message}`,
        HiveIDService.name,
      );
    }

    const payload = {
      userId,
      email,
      personId,
      firstName: cached.standardGivenName,
      lastName: cached.standardFamilyName,
      // Brand-new signup — verification mail just sent, not yet confirmed.
      // The relay carries this claim through to crowdScoredBy so TMX can gate
      // scorer-nomination on email-verified status without any extra lookup.
      email_verified: false,
    };
    const session = await this.authService.issueSession(payload, userAgent, 'hiveid');
    return {
      status: 'created' as const,
      personId,
      personRevision,
      cached,
      ...session,
    };
  }

  /**
   * POST /auth/hiveid/verify-existing — link a HiveID to an existing admin
   * account after proving control of the admin password. No new row is
   * created; the user's audience is upgraded to `['admin', 'hiveid']` and
   * — if a canonical link wasn't already resolved — the link is set now.
   */
  async verifyExisting(args: { email: string; password: string }, userAgent?: string) {
    const email = (args?.email ?? '').toLowerCase().trim();
    if (!email || !args?.password) throw new UnauthorizedException();
    const user = await this.usersService.findOne(email);
    if (!user || !user.password) throw new UnauthorizedException();

    const passwordMatch =
      user.password === args.password || (await bcrypt.compare(args.password, user.password));
    if (!passwordMatch) throw new UnauthorizedException();

    const userId = user.userId ?? user.user_id;
    let linkPersonId: string | null = null;
    let linkRevision: number | null = null;
    let cached:
      | { standardFamilyName: string | null; standardGivenName: string | null; birthDate: string | null; sex: string | null; nationalityCode: string | null }
      | null = null;

    if (userId) {
      const existingLink = await this.userStorage.getPersonLink(userId);
      if (existingLink?.personId) {
        linkPersonId = existingLink.personId;
        linkRevision = existingLink.personRevision;
        cached = {
          standardFamilyName: existingLink.cached.standardFamilyName ?? null,
          standardGivenName: existingLink.cached.standardGivenName ?? null,
          birthDate: existingLink.cached.birthDate ?? null,
          sex: existingLink.cached.sex ?? null,
          nationalityCode: existingLink.cached.nationalityCode ?? null,
        };
      } else if (user.firstName && user.lastName) {
        // Best-effort resolve. Verify-existing must not fail just because
        // the registry can't disambiguate — the audience upgrade still
        // happens, the user can complete linking via /me later.
        try {
          const resolved = await this.personsClient.resolve({
            standardGivenName: user.firstName,
            standardFamilyName: user.lastName,
            source: 'cfs-hiveid-verify-existing',
          });
          if (resolved.status === 'resolved' || resolved.status === 'minted') {
            if (resolved.personId && resolved.personRevision != null) {
              const survivor = await this.personsClient.getById(resolved.personId);
              cached = {
                standardFamilyName: survivor?.person?.standardFamilyName ?? user.lastName,
                standardGivenName: survivor?.person?.standardGivenName ?? user.firstName,
                birthDate: survivor?.person?.birthDate ?? null,
                sex: survivor?.person?.sex ?? null,
                nationalityCode: survivor?.person?.nationalityCode ?? null,
              };
              await this.userStorage.setPersonLink(userId, {
                personId: resolved.personId,
                personRevision: resolved.personRevision,
                cached,
              });
              linkPersonId = resolved.personId;
              linkRevision = resolved.personRevision;
            }
          }
        } catch (err) {
          Logger.warn(
            `hiveid verifyExisting: resolve for ${email} failed: ${(err as Error).message}`,
            HiveIDService.name,
          );
        }
      }
    }

    const payload = await this.authService.buildSessionPayload(user);
    if (linkPersonId) {
      payload.personId = linkPersonId;
      payload.personRevision = linkRevision;
    }
    // Existing admin proving control of their password — reflect their current
    // verified status (admins linking a HiveID are typically already verified).
    payload.email_verified = !!user.emailVerifiedAt;
    const session = await this.authService.issueSession(payload, userAgent, ['admin', 'hiveid']);
    return {
      status: 'verified' as const,
      personId: linkPersonId,
      personRevision: linkRevision,
      cached,
      ...session,
    };
  }

  /**
   * POST /auth/hiveid/magic-link — request a passwordless login link for a
   * HiveID account. Enumeration-defensive: always returns `{ ok: true }`
   * regardless of whether the email maps to a real user. A link is sent
   * only when a row with this `email` exists; the click stamps
   * `email_verified_at` (the magic link IS the verification).
   */
  async requestMagicLink(email: string): Promise<{ ok: true }> {
    const trimmed = (email ?? '').toLowerCase().trim();
    if (!trimmed) return { ok: true };
    try {
      const user = await this.usersService.findOne(trimmed);
      if (user?.userId && user?.email) {
        const code = HIVEID_MAGIC_LINK_PREFIX + randomBytes(32).toString('base64url');
        const expiresAt = new Date(Date.now() + HIVEID_MAGIC_LINK_TTL_MS).toISOString();
        await this.authCodeStorage.setAccessCode(code, user.email, expiresAt);
        await this.emailService.sendTemplated({
          to: user.email,
          subject: 'Your CourtHive login link',
          template: 'magic-link',
          data: {
            firstName: user.firstName ?? '',
            magicLinkUrl: this.buildMagicLinkUrl(code),
            expiresInMinutes: HIVEID_MAGIC_LINK_TTL_MINUTES,
          },
          tag: 'hiveid-magic-link',
        });
        Logger.log(`Sent HiveID magic-link to ${user.email} for user ${user.userId}`);
      } else {
        Logger.verbose(`hiveid requestMagicLink: no eligible recipient for "${trimmed}"`);
      }
    } catch (err) {
      Logger.warn(`hiveid requestMagicLink swallowed error: ${(err as Error).message}`);
    }
    return { ok: true };
  }

  /**
   * POST /auth/hiveid/magic-link/consume — exchange a single-use HiveID
   * magic-link code for an `aud: 'hiveid'` session. The code MUST carry
   * the `hmlk_` prefix; reusing admin codes here is rejected so admin
   * tokens can't be obtained through the public flow. First successful
   * consume stamps `email_verified_at` (the click is proof of control).
   */
  async consumeMagicLink(code: string, userAgent?: string) {
    if (!code || !code.startsWith(HIVEID_MAGIC_LINK_PREFIX)) {
      throw new UnauthorizedException('Invalid or expired login link');
    }
    const email = await this.authCodeStorage.consumeAccessCode(code);
    if (!email) throw new UnauthorizedException('Invalid or expired login link');

    const user = await this.usersService.findOne(email);
    if (!user) throw new UnauthorizedException();
    const userId = user.userId ?? user.user_id;
    if (!userId) throw new UnauthorizedException();

    if (!user.emailVerifiedAt) {
      try {
        await this.userStorage.markEmailVerified(userId);
      } catch (err) {
        Logger.warn(
          `hiveid consume: markEmailVerified for ${email} failed: ${(err as Error).message}`,
          HiveIDService.name,
        );
      }
    }

    const link = await this.userStorage.getPersonLink(userId);
    const payload = {
      userId,
      email: user.email,
      personId: link?.personId ?? null,
      personRevision: link?.personRevision ?? null,
      firstName: link?.cached.standardGivenName ?? user.firstName ?? null,
      lastName: link?.cached.standardFamilyName ?? user.lastName ?? null,
      // A successful magic-link consume is proof of mailbox control — the email
      // is verified by this point (stamped just above when not already set).
      email_verified: true,
    };
    const session = await this.authService.issueSession(payload, userAgent, 'hiveid');
    return {
      status: 'authenticated' as const,
      personId: payload.personId,
      personRevision: payload.personRevision,
      cached: {
        standardFamilyName: link?.cached.standardFamilyName ?? null,
        standardGivenName: link?.cached.standardGivenName ?? null,
        birthDate: link?.cached.birthDate ?? null,
        sex: link?.cached.sex ?? null,
        nationalityCode: link?.cached.nationalityCode ?? null,
      },
      ...session,
    };
  }

  /**
   * POST /auth/hiveid/resend-verification — re-send the email-verification
   * mail (public landing) for the authenticated HiveID user. Idempotent;
   * delegates to the shared IdentityService flow, which no-ops when already
   * verified or no contact_email is set.
   */
  async resendVerification(args: { userId: string; email: string; firstName?: string }) {
    if (!args?.userId || !args?.email) throw new UnauthorizedException();
    return this.identityService.resendVerification(
      { userId: args.userId, email: args.email, firstName: args.firstName },
      { landing: 'public' },
    );
  }

  /**
   * POST /auth/hiveid/me/contact-email — set or change the caller's verification
   * (contact) email. Delegates to the shared IdentityService flow, which clears
   * `email_verified_at` and fires a fresh verification mail. Lets a public user
   * fix a mistyped / never-verified email themselves. `email_verified_at` gates
   * scorer nomination, not basic access, so an unverified edit is safe.
   */
  async setContactEmail(args: { userId: string; email?: string; firstName?: string; contactEmail: string }) {
    if (!args?.userId) throw new UnauthorizedException();
    return this.identityService.setContactEmail(
      { userId: args.userId, email: args.email, firstName: args.firstName },
      args.contactEmail,
    );
  }

  /**
   * GET /auth/hiveid/me — the public-side identity projection. Returns the
   * authenticated user's canonical Person link, cached canonical fields,
   * and consent preferences. Distinct from `/auth/me` (admin context).
   */
  async getMe(userId: string) {
    if (!userId) throw new UnauthorizedException();
    // Real users resolve from storage. The dev-mode test super-admin (TEST_EMAIL)
    // has no `users` row, so fall back to the in-memory dev user — otherwise the
    // whole HiveID /me surface 401s for it in development. Unknown ids still miss
    // both and 401 (the getDevUserById guard returns null for non-test ids).
    const user = (await this.userStorage.findByUserId(userId)) ?? this.usersService.getDevUserById(userId);
    if (!user) throw new UnauthorizedException();
    const link = await this.userStorage.getPersonLink(userId);
    return {
      userId,
      email: user.email,
      // The verification (contact) email — where the verify mail is sent. Distinct
      // from the login `email`; equals it at signup, diverges once edited. The /me
      // UI shows + edits this while it is unverified.
      contactEmail: user.contactEmail ?? user.email ?? null,
      emailVerifiedAt: user.emailVerifiedAt ?? null,
      personId: link?.personId ?? null,
      personRevision: link?.personRevision ?? null,
      cached: {
        standardFamilyName: link?.cached.standardFamilyName ?? null,
        standardGivenName: link?.cached.standardGivenName ?? null,
        birthDate: link?.cached.birthDate ?? null,
        sex: link?.cached.sex ?? null,
        nationalityCode: link?.cached.nationalityCode ?? null,
      },
      consentPreferences: link?.consentPreferences ?? {},
    };
  }


  /**
   * Magic-link URL surface for HiveID lands on the courthive-public app,
   * not TMX. Path under APP_BASE_URL is configurable via PUBLIC_URL
   * (defaults to '/public/'); fragment route mirrors the admin shape.
   */
  private buildMagicLinkUrl(code: string): string {
    const appConfig: any = this.configService.get('app');
    const base = String(appConfig?.baseUrl ?? process.env.APP_BASE_URL ?? '').replace(/\/+$/, '');
    if (!base) {
      throw new Error('APP_BASE_URL is not set; cannot generate HiveID magic-link.');
    }
    const publicPath = `/${(process.env.PUBLIC_URL ?? '/public/').replace(/^\/+|\/+$/g, '')}/`;
    return `${base}${publicPath}#/hiveid/magic/${code}`;
  }

}
