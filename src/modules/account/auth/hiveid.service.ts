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
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';

import {
  AUTH_CODE_STORAGE,
  type IAuthCodeStorage,
  USER_STORAGE,
  type IUserStorage,
} from 'src/storage/interfaces';
import { ConfigService } from '@nestjs/config';
import { CANONICAL_PERSON, HIVEID_MAGIC_LINK_PREFIX } from './hiveid.constants';
import { executionQueue as runExecutionQueue } from '../../factory/functions/private/executionQueue';
import { PersonsClient, type PersonFragmentInput } from '../persons/persons-client.service';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { AuditService } from '../../audit/audit.service';
import type { HiveIDSignupDto } from './dto/hiveidSignup.dto';
import { EmailService } from '../email/email.service';
import { UsersService } from '../../users/users.service';
import { AuthService } from './auth.service';

const HIVEID_MAGIC_LINK_TTL_MINUTES = 15;
const HIVEID_MAGIC_LINK_TTL_MS = HIVEID_MAGIC_LINK_TTL_MINUTES * 60 * 1000;

export interface ParticipationRow {
  tournamentId: string;
  tournamentName: string;
  startDate: string | null;
  endDate: string | null;
  participantId: string;
  participantName: string;
  eventCount: number;
}

export interface ClaimableCandidate {
  participantId: string;
  participantName: string;
  sex: string | null;
  nationalityCode: string | null;
  birthDate: string | null;
  alreadyLinkedTo: string | null;
}

function normalizeName(value: string): string {
  return String(value ?? '').trim().toLowerCase();
}

function isIndividualParticipant(participant: any): boolean {
  return (participant?.participantType ?? 'INDIVIDUAL') === 'INDIVIDUAL';
}

function extractCanonicalPersonId(participant: any): string | null {
  const otherIds: any[] = participant?.person?.personOtherIds ?? [];
  const hit = otherIds.find((o) => o?.organisationId === CANONICAL_PERSON);
  return hit?.personId ?? null;
}

function participantMatchesPerson(participant: any, personId: string): boolean {
  return extractCanonicalPersonId(participant) === personId;
}

function countParticipantEvents(tournament: any, participantId: string): number {
  let count = 0;
  for (const event of tournament?.events ?? []) {
    const entries = event?.entries ?? [];
    if (entries.some((e: any) => e?.participantId === participantId)) count++;
  }
  return count;
}

function byStartDateDesc(a: ParticipationRow, b: ParticipationRow): number {
  const aDate = a.startDate ?? '';
  const bDate = b.startDate ?? '';
  if (aDate === bDate) return a.tournamentName.localeCompare(b.tournamentName);
  return aDate < bDate ? 1 : -1;
}

@Injectable()
export class HiveIDService {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    private readonly personsClient: PersonsClient,
    private readonly tournamentStorageService: TournamentStorageService,
    private readonly auditService: AuditService,
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

    const fragment: PersonFragmentInput = {
      standardGivenName: body.firstName.trim(),
      standardFamilyName: body.lastName.trim(),
      personOtherIds: (body.federationIds ?? [])
        .filter((f) => f?.provider && f?.externalId)
        .map((f) => ({ provider: f.provider, externalId: f.externalId })),
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

    const payload = {
      userId,
      email,
      personId,
      firstName: cached.standardGivenName,
      lastName: cached.standardFamilyName,
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
   * GET /auth/hiveid/me — the public-side identity projection. Returns the
   * authenticated user's canonical Person link, cached canonical fields,
   * and consent preferences. Distinct from `/auth/me` (admin context).
   */
  async getMe(userId: string) {
    if (!userId) throw new UnauthorizedException();
    const user = await this.userStorage.findByUserId(userId);
    if (!user) throw new UnauthorizedException();
    const link = await this.userStorage.getPersonLink(userId);
    return {
      userId,
      email: user.email,
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
   * GET /auth/hiveid/me/participations — surface all tournaments where
   * the caller has been claimed as a Participant via the CANONICAL_PERSON
   * organisationId. Scans every tournament record server-side; acceptable
   * for early adoption (handful of HiveID users) and trivially cacheable
   * later when volume grows.
   */
  async getMyParticipations(userId: string): Promise<{
    personId: string | null;
    participations: ParticipationRow[];
  }> {
    if (!userId) throw new UnauthorizedException();
    const link = await this.userStorage.getPersonLink(userId);
    const personId = link?.personId ?? null;
    if (!personId) return { personId: null, participations: [] };

    const tournamentIds = await this.tournamentStorageService.listTournamentIds();
    if (!tournamentIds.length) return { personId, participations: [] };

    const { tournamentRecords } = (await this.tournamentStorageService.fetchTournamentRecords({
      tournamentIds,
    })) as { tournamentRecords?: Record<string, any> };
    if (!tournamentRecords) return { personId, participations: [] };

    const out: ParticipationRow[] = [];
    for (const tournament of Object.values(tournamentRecords)) {
      const tid = tournament?.tournamentId;
      if (!tid) continue;
      const participants: any[] = tournament?.participants ?? [];
      for (const participant of participants) {
        if (!participantMatchesPerson(participant, personId)) continue;
        out.push({
          tournamentId: tid,
          tournamentName: tournament.tournamentName ?? '',
          startDate: tournament.startDate ?? null,
          endDate: tournament.endDate ?? null,
          participantId: participant.participantId,
          participantName: participant.participantName ?? '',
          eventCount: countParticipantEvents(tournament, participant.participantId),
        });
      }
    }
    out.sort(byStartDateDesc);
    return { personId, participations: out };
  }

  /**
   * GET /auth/hiveid/me/claimable/:tournamentId — returns the Participants
   * in the given tournament whose canonical name overlaps the caller's
   * cached fields, MINUS anyone already linked to the caller's personId.
   * Defense-in-depth: the actual claim mutation re-verifies before
   * stamping (see `claimParticipant`).
   */
  async getClaimableForTournament(userId: string, tournamentId: string): Promise<{
    tournamentId: string;
    candidates: ClaimableCandidate[];
  }> {
    if (!userId) throw new UnauthorizedException();
    if (!tournamentId) throw new BadRequestException('tournamentId is required');

    const link = await this.userStorage.getPersonLink(userId);
    const personId = link?.personId ?? null;
    const cached = link?.cached;
    if (!cached?.standardGivenName || !cached?.standardFamilyName) {
      return { tournamentId, candidates: [] };
    }

    const { tournamentRecord } = await this.tournamentStorageService.findTournamentRecord({ tournamentId });
    if (!tournamentRecord) return { tournamentId, candidates: [] };

    const targetGiven = normalizeName(cached.standardGivenName);
    const targetFamily = normalizeName(cached.standardFamilyName);
    const participants: any[] = tournamentRecord.participants ?? [];
    const candidates: ClaimableCandidate[] = [];
    for (const p of participants) {
      if (!isIndividualParticipant(p)) continue;
      if (personId && participantMatchesPerson(p, personId)) continue;
      const personGiven = normalizeName(p?.person?.standardGivenName ?? p?.person?.givenName ?? '');
      const personFamily = normalizeName(p?.person?.standardFamilyName ?? p?.person?.familyName ?? '');
      const nameMatches =
        (personGiven && personGiven === targetGiven) ||
        (personFamily && personFamily === targetFamily);
      if (!nameMatches) continue;
      candidates.push({
        participantId: p.participantId,
        participantName: p.participantName ?? '',
        sex: p?.person?.sex ?? null,
        nationalityCode: p?.person?.nationalityCode ?? null,
        birthDate: p?.person?.birthDate ?? null,
        alreadyLinkedTo: extractCanonicalPersonId(p),
      });
    }
    return { tournamentId, candidates };
  }

  /**
   * POST /auth/hiveid/me/claim — stamp a `CANONICAL_PERSON`-keyed entry
   * onto the target Participant's `Person.personOtherIds[]` via the
   * `addPersonOtherId` factory mutation (PR-K). Defense-in-depth: the
   * server reloads the tournament and re-verifies the participant exists
   * and that the cached name overlaps before firing.
   */
  async claimParticipant(args: {
    userId: string;
    tournamentId: string;
    participantId: string;
    auditSource?: string;
  }): Promise<{ success: true; tournamentId: string; participantId: string; personId: string }> {
    const { userId, tournamentId, participantId } = args;
    if (!userId) throw new UnauthorizedException();
    if (!tournamentId || !participantId) {
      throw new BadRequestException('tournamentId and participantId are required');
    }

    const link = await this.userStorage.getPersonLink(userId);
    const personId = link?.personId;
    if (!personId) {
      throw new BadRequestException('Your HiveID does not yet have a canonical link.');
    }

    const { tournamentRecord } = await this.tournamentStorageService.findTournamentRecord({ tournamentId });
    if (!tournamentRecord) throw new BadRequestException('Tournament not found');
    const target = (tournamentRecord.participants ?? []).find((p: any) => p?.participantId === participantId);
    if (!target) throw new BadRequestException('Participant not found in tournament');
    if (!isIndividualParticipant(target)) {
      throw new BadRequestException('Only INDIVIDUAL participants can be claimed');
    }

    const cached = link.cached;
    const targetGiven = normalizeName(cached?.standardGivenName ?? '');
    const targetFamily = normalizeName(cached?.standardFamilyName ?? '');
    const personGiven = normalizeName(target?.person?.standardGivenName ?? target?.person?.givenName ?? '');
    const personFamily = normalizeName(target?.person?.standardFamilyName ?? target?.person?.familyName ?? '');
    const overlap =
      (targetGiven && targetGiven === personGiven) || (targetFamily && targetFamily === personFamily);
    if (!overlap) {
      throw new BadRequestException(
        'The target participant does not match your canonical name. If this is you, contact the tournament director.',
      );
    }

    const result = await runExecutionQueue(
      {
        tournamentIds: [tournamentId],
        methods: [
          {
            method: 'addPersonOtherId',
            params: {
              tournamentId,
              participantId,
              organisationId: CANONICAL_PERSON,
              personId,
            },
          },
        ],
        userId,
        userEmail: undefined,
        source: args.auditSource ?? 'hiveid-claim',
      },
      undefined,
      this.tournamentStorageService,
      this.auditService,
    );
    if (!result?.success) {
      const error = result?.error ?? 'addPersonOtherId mutation failed';
      throw new BadRequestException(typeof error === 'string' ? error : JSON.stringify(error));
    }
    return { success: true, tournamentId, participantId, personId };
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
