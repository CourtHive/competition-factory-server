import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ASSIGNMENT_STORAGE, type IAssignmentStorage, USER_STORAGE, type IUserStorage } from 'src/storage/interfaces';
import { canViewTournamentMetadata, getCreatedByUserId } from '../factory/helpers/checkTournamentAccess';
import type { UserContext } from '../account/auth/decorators/user-context.decorator';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { sessionProviderId } from '../factory/helpers/actingProviderScope';
import { parseReport, UUID, boundedText } from './support-input';
import { SupportStore } from './support.store';

/**
 * Why a support request was refused. Returned beside the status so a client can say why (TMX shows it in the report
 * dialog), and logged with the internal user id only: never report content, email or contact data. A receipt that is
 * not the caller's stays a bare 404 on purpose, indistinguishable from one that does not exist.
 *
 * Added 2026-11-22: production refused a super-admin's report with a bare 403 and logged nothing; nginx's access log
 * was the only trace (the session had no acting provider).
 */
export const SUPPORT_REFUSAL = {
  IDENTITY_REQUIRED: 'SUPPORT_IDENTITY_REQUIRED',
  ADMIN_REQUIRED: 'SUPPORT_ADMIN_REQUIRED',
  INTAKE_DISABLED: 'SUPPORT_INTAKE_DISABLED',
  NO_SESSION_PROVIDER: 'SUPPORT_NO_SESSION_PROVIDER',
  PROVIDER_NOT_PERMITTED: 'SUPPORT_PROVIDER_NOT_PERMITTED',
  SESSION_CHANGED: 'SUPPORT_SESSION_CHANGED',
  TOURNAMENT_NOT_VISIBLE: 'SUPPORT_TOURNAMENT_NOT_VISIBLE',
  RESOLUTION_REQUIRED: 'SUPPORT_RESOLUTION_REQUIRED',
} as const;
type SupportRefusal = (typeof SUPPORT_REFUSAL)[keyof typeof SUPPORT_REFUSAL];

const REFUSAL_MESSAGES: Record<SupportRefusal, string> = {
  SUPPORT_IDENTITY_REQUIRED: 'Sign in with a user account to report a problem',
  SUPPORT_ADMIN_REQUIRED: 'Only a super-admin can use the support inbox',
  SUPPORT_INTAKE_DISABLED: 'New support reports are disabled',
  SUPPORT_NO_SESSION_PROVIDER: 'Select a provider before reporting a problem',
  SUPPORT_PROVIDER_NOT_PERMITTED: 'This account cannot report for the selected provider',
  SUPPORT_SESSION_CHANGED: 'Reporting session changed',
  SUPPORT_TOURNAMENT_NOT_VISIBLE: 'This account cannot report on that tournament',
  SUPPORT_RESOLUTION_REQUIRED: 'Resolution text required',
};

function refuse(code: SupportRefusal, operation: string, ctx?: UserContext): never {
  Logger.warn(`${operation} refused: ${code} (user ${ctx?.userId ?? 'none'})`, 'Support');
  const body = { message: REFUSAL_MESSAGES[code], code };
  if (code === SUPPORT_REFUSAL.INTAKE_DISABLED) throw new ServiceUnavailableException({ ...body, statusCode: 503 });
  throw new ForbiddenException({ ...body, statusCode: 403 });
}

@Injectable()
export class SupportService {
  constructor(
    private readonly store: SupportStore,
    private readonly tournaments: TournamentStorageService,
    @Inject(ASSIGNMENT_STORAGE) private readonly assignments: IAssignmentStorage,
    @Inject(USER_STORAGE) private readonly users: IUserStorage,
  ) {}

  identity(ctx?: UserContext) {
    if (!ctx?.userId || ctx.apiKey) refuse(SUPPORT_REFUSAL.IDENTITY_REQUIRED, 'support access', ctx);
    return ctx;
  }
  admin(ctx?: UserContext) {
    const identity = this.identity(ctx);
    if (!identity.isSuperAdmin) refuse(SUPPORT_REFUSAL.ADMIN_REQUIRED, 'support inbox', identity);
    return identity;
  }
  reference(value: string) {
    if (!UUID.test(value)) throw new NotFoundException();
    return value;
  }

  async submit(body: unknown, context?: UserContext) {
    const ctx = this.identity(context);
    if (process.env.SUPPORT_REPORTS_ENABLED !== 'true') refuse(SUPPORT_REFUSAL.INTAKE_DISABLED, 'support submit', ctx);
    const providerId = sessionProviderId(ctx);
    const providers = [...ctx.providerIds, ...(ctx.provisionerProviderIds ?? [])];
    if (!providerId) refuse(SUPPORT_REFUSAL.NO_SESSION_PROVIDER, 'support submit', ctx);
    if (!ctx.isSuperAdmin && !providers.includes(providerId))
      refuse(SUPPORT_REFUSAL.PROVIDER_NOT_PERMITTED, 'support submit', ctx);
    const input = parseReport(body);
    // These are comparison fences, never ownership claims. A refresh must not retarget an old form to a new session.
    if (
      input.expectedProvider !== providerId ||
      (input.expectedReporter !== ctx.userId && input.expectedReporter.toLowerCase() !== ctx.email?.toLowerCase())
    )
      refuse(SUPPORT_REFUSAL.SESSION_CHANGED, 'support submit', ctx);
    if (input.tournamentId) {
      const view: any = await this.tournaments.fetchTournamentUpdatedAt({ tournamentId: input.tournamentId });
      if (!view?.success || view.providerId !== providerId)
        refuse(SUPPORT_REFUSAL.TOURNAMENT_NOT_VISIBLE, 'support submit', ctx);
      const assignments = await this.assignments.findByUserId(ctx.userId, providerId);
      const metadata = {
        tournamentId: input.tournamentId,
        providerId: view.providerId,
        createdByUserId: getCreatedByUserId(view),
      };
      if (!canViewTournamentMetadata(metadata, ctx, new Set(assignments.map((a) => a.tournamentId))))
        refuse(SUPPORT_REFUSAL.TOURNAMENT_NOT_VISIBLE, 'support submit', ctx);
    }
    const row = await this.store.submit(input, ctx.userId, providerId);
    return this.receipt(row.reference, ctx);
  }

  async receipt(reference: string, context?: UserContext) {
    const ctx = this.identity(context);
    const row = await this.store.get(this.reference(reference));
    if (row.reporter_id !== ctx.userId) throw new NotFoundException();
    const user = await this.users.findByUserId(ctx.userId);
    return {
      reference: row.reference,
      accepted: true,
      snapshot: 'not_attached',
      expiresAt: row.expires_at,
      contact: user?.contactEmail && user?.emailVerifiedAt ? 'verified' : 'pending',
      resolutionEmail: row.send_state,
      delivery: row.send_state === 'accepted' ? 'unknown' : 'not_sent',
    };
  }

  list(offset: number, ctx?: UserContext) {
    this.admin(ctx);
    return this.store.list(offset);
  }
  show(reference: string, ctx?: UserContext) {
    this.admin(ctx);
    return this.store.get(this.reference(reference));
  }
  resolve(reference: string, body: unknown, ctx?: UserContext) {
    const admin = this.admin(ctx);
    if (!body || typeof body !== 'object' || Object.keys(body).length !== 1 || !('resolution' in body))
      refuse(SUPPORT_REFUSAL.RESOLUTION_REQUIRED, 'support resolve', admin);
    return this.store.resolve(this.reference(reference), boundedText((body as any).resolution, 16384), admin.userId);
  }
}
