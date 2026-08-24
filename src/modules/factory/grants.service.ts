import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  GRANT_STORAGE,
  type IGrantStorage,
  USER_PROVIDER_STORAGE,
  type IUserProviderStorage,
  USER_STORAGE,
  type IUserStorage,
} from 'src/storage/interfaces';
import { INSUFFICIENT_PERMISSIONS, isProviderAdminFor } from './helpers/providerAdmin';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { isWithinWindow } from './helpers/grantScope';
import { isUuid, validateScope, validateWindow, validateCapability } from './helpers/grantValidation';

import type { UserContext } from '../account/auth/decorators/user-context.decorator';
import type { GrantScope } from './helpers/grantScope';

/** What a client needs to shape its UI. Deliberately not the storage row. */
export type CallerGrant = {
  capability: string;
  scope: GrantScope;
  notBefore?: string | null;
  notAfter?: string | null;
};

export type CreateGrantParams = {
  tournamentId: string;
  userEmail: string;
  capability: string;
  scope?: GrantScope;
  notBefore?: string | null;
  notAfter?: string | null;
};

@Injectable()
export class GrantsService {
  private readonly logger = new Logger(GrantsService.name);

  constructor(
    @Inject(GRANT_STORAGE) private readonly grantStorage: IGrantStorage,
    @Inject(USER_PROVIDER_STORAGE) private readonly userProviderStorage: IUserProviderStorage,
    @Inject(USER_STORAGE) private readonly userStorage: IUserStorage,
    private readonly tournamentStorageService: TournamentStorageService,
  ) {}

  /**
   * The caller's own live grants on a tournament, so the client can shape its UI
   * to what the server would actually permit.
   *
   * Returns the caller's rows only — never another subject's — so there is
   * nothing here to leak. Expired and not-yet-live grants are filtered out
   * rather than shipped with their windows, because a client that had to
   * re-implement the window check would be a second place for that logic to
   * drift from the gate.
   *
   * An empty array is NOT "restricted to nothing". It means the subject holds no
   * scoped grants and is therefore unrestricted by this mechanism, which is what
   * the server-side gate concludes too.
   */
  async forCaller(tournamentId: string, userContext: UserContext | undefined): Promise<CallerGrant[]> {
    if (!userContext?.userId || !tournamentId) return [];
    try {
      const rows = await this.grantStorage.findForSubject(userContext.userId, tournamentId);
      return rows
        .filter((row) => isWithinWindow(row))
        .map(({ capability, scope, notBefore, notAfter }) => ({ capability, scope, notBefore, notAfter }));
    } catch {
      // Storage unavailable (migration not yet applied) — the gate falls through
      // to the coarse checks in that case, so the client should too.
      return [];
    }
  }

  /**
   * Create a scoped grant.
   *
   * The owning provider is read from the tournament record, never from the
   * request: a caller who administers provider A must not be able to grant on
   * provider B's tournament by naming A. Everything the gate would silently
   * refuse forever — an unevaluable scope, a capability that is not a
   * permission key, a window that has already closed — is rejected here instead
   * of stored.
   */
  async create(params: CreateGrantParams, grantor: UserContext | undefined) {
    const { tournamentId, userEmail, capability, scope, notBefore, notAfter } = params ?? ({} as CreateGrantParams);
    if (!tournamentId) return { error: 'tournamentId is required' };
    if (!userEmail) return { error: 'userEmail is required' };

    const providerId = await this.resolveProviderId(tournamentId);
    if (!providerId) return { error: 'Tournament not found, or it has no owning provider' };
    if (!isProviderAdminFor(grantor, providerId)) return { error: INSUFFICIENT_PERMISSIONS };

    const invalid = validateCapability(capability) ?? validateScope(scope) ?? validateWindow(notBefore, notAfter);
    if (invalid) return { error: invalid };

    const grantee = await this.userStorage.findOne(userEmail);
    if (!grantee) return { error: 'User not found' };
    const granteeUserId = grantee.userId ?? grantee.user_id;
    if (!granteeUserId) return { error: 'User has no UUID — schema migration may not have run' };

    // Mirrors AssignmentsService.grant: a grant is a narrowing of access at a
    // provider, so it presupposes membership of that provider rather than
    // conferring it.
    const association = await this.userProviderStorage.findOne(granteeUserId, providerId);
    if (!association) return { error: 'User is not associated with this provider — invite them first' };

    const { grantId } = await this.grantStorage.create({
      tournamentId,
      userId: granteeUserId,
      providerId,
      capability,
      scope: scope ?? {},
      notBefore: notBefore ?? null,
      notAfter: notAfter ?? null,
      grantedBy: grantor?.userId ?? null,
    });

    this.logger.log(
      `Granted ${userEmail} "${capability}" on ${tournamentId} (scope ${JSON.stringify(scope ?? {})}, grant ${grantId})`,
    );
    return { success: true, grantId };
  }

  /**
   * Revoke a grant by id.
   *
   * Authorized against the grant's own `provider_id` — read from the row, not
   * supplied by the caller — so revocation cannot be aimed at another
   * provider's grants by naming a provider the caller happens to administer.
   */
  async revoke(grantId: string, grantor: UserContext | undefined) {
    // A malformed id is a miss, not a 500: `grant_id` is UUID-typed, so the
    // driver would reject the syntax before the row was ever looked for.
    if (!isUuid(grantId)) return { error: 'Grant not found' };

    const row = await this.grantStorage.findById(grantId);
    if (!row) return { error: 'Grant not found' };
    if (!isProviderAdminFor(grantor, row.providerId)) return { error: INSUFFICIENT_PERMISSIONS };

    const { success } = await this.grantStorage.revoke(grantId);
    this.logger.log(`Revoked grant ${grantId} ("${row.capability}" on ${row.tournamentId})`);
    return { success };
  }

  /**
   * Every grant on a tournament, for a management surface.
   *
   * The AMS console does NOT use this — per PROVIDER_SERVICES_BOUNDARY.md it
   * renders from its own read-only pool. This exists for parity and for
   * consumers that hold no database connection.
   *
   * Grantee emails are resolved in one query against the provider's
   * associations rather than one lookup per grant.
   */
  async listForTournament(tournamentId: string, caller: UserContext | undefined) {
    if (!tournamentId) return { error: 'tournamentId is required' };

    const providerId = await this.resolveProviderId(tournamentId);
    if (!providerId) return { error: 'Tournament not found, or it has no owning provider' };
    if (!isProviderAdminFor(caller, providerId)) return { error: INSUFFICIENT_PERMISSIONS };

    const rows = await this.grantStorage.findByTournamentId(tournamentId);
    const emailByUserId = new Map(
      (await this.userProviderStorage.findByProviderId(providerId)).map((row) => [row.userId, row.email]),
    );

    const grants = rows.map((row) => ({
      ...row,
      email: emailByUserId.get(row.userId),
      live: isWithinWindow(row),
    }));
    return { success: true, grants };
  }

  /**
   * The provider that owns a tournament, or undefined when either the
   * tournament or its ownership cannot be resolved.
   *
   * `parentOrganisation.organisationId` is the same field the mutation gate
   * reads to pick a provider's permission caps, so a grant is authorized
   * against exactly the provider whose caps will bound it.
   */
  private async resolveProviderId(tournamentId: string): Promise<string | undefined> {
    const result: any = await this.tournamentStorageService.fetchTournamentRecords({ tournamentId });
    const tournament = result?.tournamentRecords?.[tournamentId];
    return tournament?.parentOrganisation?.organisationId;
  }
}
