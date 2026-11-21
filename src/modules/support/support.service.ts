import { ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ASSIGNMENT_STORAGE, type IAssignmentStorage, USER_STORAGE, type IUserStorage } from 'src/storage/interfaces';
import { canViewTournamentMetadata, getCreatedByUserId } from '../factory/helpers/checkTournamentAccess';
import type { UserContext } from '../account/auth/decorators/user-context.decorator';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { sessionProviderId } from '../factory/helpers/actingProviderScope';
import { parseReport, UUID, boundedText } from './support-input';
import { SupportStore } from './support.store';

@Injectable()
export class SupportService {
  constructor(
    private readonly store: SupportStore,
    private readonly tournaments: TournamentStorageService,
    @Inject(ASSIGNMENT_STORAGE) private readonly assignments: IAssignmentStorage,
    @Inject(USER_STORAGE) private readonly users: IUserStorage,
  ) {}

  identity(ctx?: UserContext) {
    if (!ctx?.userId || ctx.apiKey) throw new ForbiddenException();
    return ctx;
  }
  admin(ctx?: UserContext) {
    const identity = this.identity(ctx);
    if (!identity.isSuperAdmin) throw new ForbiddenException();
    return identity;
  }
  reference(value: string) {
    if (!UUID.test(value)) throw new NotFoundException();
    return value;
  }

  async submit(body: unknown, context?: UserContext) {
    const ctx = this.identity(context);
    if (process.env.SUPPORT_REPORTS_ENABLED !== 'true')
      throw new ServiceUnavailableException('New support reports are disabled');
    const providerId = sessionProviderId(ctx);
    const providers = [...ctx.providerIds, ...(ctx.provisionerProviderIds ?? [])];
    if (!providerId || (!ctx.isSuperAdmin && !providers.includes(providerId))) throw new ForbiddenException();
    const input = parseReport(body);
    // These are comparison fences, never ownership claims. A refresh must not retarget an old form to a new session.
    if (
      input.expectedProvider !== providerId ||
      (input.expectedReporter !== ctx.userId && input.expectedReporter.toLowerCase() !== ctx.email?.toLowerCase())
    )
      throw new ForbiddenException('Reporting session changed');
    if (input.tournamentId) {
      const view: any = await this.tournaments.fetchTournamentUpdatedAt({ tournamentId: input.tournamentId });
      if (!view?.success || view.providerId !== providerId) throw new ForbiddenException();
      const assignments = await this.assignments.findByUserId(ctx.userId, providerId);
      const metadata = {
        tournamentId: input.tournamentId,
        providerId: view.providerId,
        createdByUserId: getCreatedByUserId(view),
      };
      if (!canViewTournamentMetadata(metadata, ctx, new Set(assignments.map((a) => a.tournamentId))))
        throw new ForbiddenException();
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
      throw new ForbiddenException('Resolution text required');
    return this.store.resolve(this.reference(reference), boundedText((body as any).resolution, 16384), admin.userId);
  }
}
