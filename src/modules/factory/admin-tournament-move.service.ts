import { TournamentBroadcastService } from '../messaging/broadcast/tournament-broadcast.service';
import { MutationServicesService } from '../mutation-services/mutation-services.service';
import { SnapshotProjectionService } from './projection/snapshot-projection.service';
import type { UserContext } from '../account/auth/decorators/user-context.decorator';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { afterCommandCommit } from 'src/storage/postgres/commandTransaction';
import { runDurableCommand } from 'src/storage/postgres/commandReceipts';
import { withTournamentLock } from 'src/services/tournamentMutex';
import { isCalendarListed } from 'src/helpers/calendarListing';
import { AuditService } from '../audit/audit.service';
import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  ASSIGNMENT_STORAGE,
  GRANT_STORAGE,
  PROVIDER_STORAGE,
  PROVISIONER_PROVIDER_STORAGE,
  TOURNAMENT_PROVISIONER_STORAGE,
  type IAssignmentStorage,
  type IGrantStorage,
  type IProviderStorage,
  type IProvisionerProviderStorage,
  type ITournamentProvisionerStorage,
} from 'src/storage/interfaces';

/**
 * Super-admin repair: move a tournament from one provider to another (Mentat
 * planning/SUPERADMIN_TOURNAMENT_PROVIDER_MOVE.md, D1–D5 ruled by CA 2026-11-07).
 *
 * Replaces hand-written SQL. The authority is the record's `parentOrganisation`; the save path already derives
 * `tournaments.provider_id`, the calendar row (columns AND its embedded identity) and the participation index from
 * it, so this rewrites `parentOrganisation` and SAVES — it never re-implements those derivations. The first hand move
 * updated the columns and missed `calendar_tournaments.identity`; going through the save is what makes that class of
 * miss impossible here.
 *
 * Everything that changes is one durable command: the record, the old provider's access rows (D2), the
 * `tournament_provisioner` mapping (D3), the read-model snapshot and the audit row commit together or not at all, and a
 * resend with the same `commandId` returns the original answer. Clients are told only after the commit (D4).
 */

export const MOVE_REASON = 'providerMoved';
export const PROVIDER_MOVES_EXTENSION = 'providerMoves';

export type MoveProviderRequest = {
  tournamentId: string;
  /** The caller's statement of the current provider. Refused when wrong, so a stale screen cannot move it twice. */
  fromProviderId: string;
  toProviderId: string;
  reason?: string;
  /** D2: revoke the old provider's assignments and grants in the same command. Without it they block the move. */
  revokeAccess?: boolean;
  /** D3: the destination is not under the tournament's provisioner. Refused unless confirmed. */
  crossProvisioner?: boolean;
  dryRun?: boolean;
  commandId?: string;
};

export type MoveBlocker = 'ACCESS_ROWS_PRESENT' | 'CROSS_PROVISIONER_UNCONFIRMED';

type ProviderIdentity = {
  providerId: string;
  organisationName?: string;
  organisationAbbreviation?: string;
};

export type MovePlan = {
  tournamentId: string;
  tournamentName?: string;
  from: ProviderIdentity;
  to: ProviderIdentity;
  calendarListed: boolean;
  accessRows: {
    assignments: Array<{ userId: string; email?: string; assignmentRole: string }>;
    grants: Array<{ grantId: string; userId: string; capability: string }>;
  };
  provisioner: {
    crossProvisioner: boolean;
    tournamentProvisioner: { provisionerId: string; providerId: string } | null;
    /** What `tournament_provisioner` becomes: unchanged provisioner for a same-provisioner move, null = row removed. */
    after: { provisionerId: string; providerId: string } | null;
  };
  blockers: MoveBlocker[];
};

const fail = (error: string, extra: Record<string, any> = {}) => ({ error, ...extra });

export function moveFingerprint(request: MoveProviderRequest): string {
  const { tournamentId, fromProviderId, toProviderId, reason, revokeAccess, crossProvisioner } = request;
  return createHash('sha256')
    .update(
      JSON.stringify({
        kind: 'move-provider',
        tournamentId,
        fromProviderId,
        toProviderId,
        reason: reason?.trim() ?? '',
        revokeAccess: !!revokeAccess,
        crossProvisioner: !!crossProvisioner,
      }),
    )
    .digest('hex');
}

/** The destination's identity from its PROVIDERS row — never from the request — keeping the other keys (caps). */
export function movedParentOrganisation(current: any, destination: any) {
  return {
    ...(current ?? {}),
    organisationId: destination.organisationId,
    organisationName: destination.organisationName,
    organisationAbbreviation: destination.organisationAbbreviation,
    onlineResources: destination.onlineResources ?? [],
  };
}

@Injectable()
export class AdminTournamentMoveService {
  constructor(
    private readonly tournamentStorageService: TournamentStorageService,
    private readonly snapshotProjection: SnapshotProjectionService,
    private readonly mutationServices: MutationServicesService,
    private readonly auditService: AuditService,
    private readonly broadcastService: TournamentBroadcastService,
    @Inject(PROVIDER_STORAGE) private readonly providerStorage: IProviderStorage,
    @Inject(PROVISIONER_PROVIDER_STORAGE) private readonly provisionerProviders: IProvisionerProviderStorage,
    @Inject(TOURNAMENT_PROVISIONER_STORAGE) private readonly tournamentProvisioners: ITournamentProvisionerStorage,
    @Inject(ASSIGNMENT_STORAGE) private readonly assignments: IAssignmentStorage,
    @Inject(GRANT_STORAGE) private readonly grants: IGrantStorage,
  ) {}

  async moveProvider(request: MoveProviderRequest, userContext: UserContext) {
    if (!userContext?.isSuperAdmin) return fail('SUPER_ADMIN_REQUIRED');
    if (!request?.tournamentId || !request.fromProviderId || !request.toProviderId) return fail('MISSING_PARAMETERS');

    if (request.dryRun) {
      const planned = await this.planMove(request);
      return planned.error ? planned : { success: true, dryRun: true, plan: planned.plan };
    }

    const reason = request.reason?.trim();
    if (!reason) return fail('REASON_REQUIRED');
    if (!request.commandId) return fail('COMMAND_ID_REQUIRED');

    const durable = {
      commandId: request.commandId,
      commandActor: userContext.userId,
      commandFingerprint: moveFingerprint(request),
    };
    const receipts = this.mutationServices.build().commandReceipts;

    return withTournamentLock([request.tournamentId], () =>
      runDurableCommand(durable, receipts, () => this.applyMove({ ...request, reason }, userContext)),
    );
  }

  /** Read-only: everything the move would change and what blocks it. The move re-plans inside its lock. */
  async planMove(
    request: MoveProviderRequest,
  ): Promise<{ error?: string; plan?: MovePlan; record?: any; [k: string]: any }> {
    const { tournamentId, fromProviderId, toProviderId } = request;
    if (fromProviderId === toProviderId) return fail('SAME_PROVIDER');

    const fetched: any = await this.tournamentStorageService.fetchTournamentRecords({ tournamentId });
    const record = fetched?.tournamentRecords?.[tournamentId];
    if (!record) return fail('TOURNAMENT_NOT_FOUND');

    const currentProviderId = record.parentOrganisation?.organisationId;
    if (currentProviderId !== fromProviderId) return fail('FROM_PROVIDER_MISMATCH', { currentProviderId });

    const destination = await this.providerStorage.getProvider(toProviderId);
    if (!destination) return fail('DESTINATION_NOT_FOUND');

    const [assignments, grants, mapping, fromOwners, toOwners] = await Promise.all([
      this.assignments.findByTournamentId(tournamentId),
      this.grants.findByTournamentId(tournamentId),
      this.tournamentProvisioners.getByTournament(tournamentId),
      this.provisionerProviders.findByProvider(fromProviderId),
      this.provisionerProviders.findByProvider(toProviderId),
    ]);

    // Only the OLD provider's rows are the move's business: a row another provider granted is untouched.
    const oldAssignments = assignments.filter((a) => a.providerId === fromProviderId);
    const oldGrants = grants.filter((g) => g.providerId === fromProviderId);

    const toProvisionerIds = new Set(toOwners.map((r) => r.provisionerId));
    // The mapping row, when present, names the tournament's provisioner. Without one, the providers' own
    // provisioners decide: a move is within one provisioner when the two share one (or neither has any).
    const crossProvisioner = mapping
      ? !toProvisionerIds.has(mapping.provisionerId)
      : (fromOwners.length > 0 || toOwners.length > 0) &&
        !fromOwners.some((r) => toProvisionerIds.has(r.provisionerId));
    const destinationOwner = toOwners.find((r) => r.relationship === 'owner') ?? toOwners[0];
    const mappingAfter = !mapping
      ? null
      : crossProvisioner
        ? destinationOwner
          ? { provisionerId: destinationOwner.provisionerId, providerId: toProviderId }
          : null
        : { provisionerId: mapping.provisionerId, providerId: toProviderId };

    const blockers: MoveBlocker[] = [];
    if ((oldAssignments.length || oldGrants.length) && !request.revokeAccess) blockers.push('ACCESS_ROWS_PRESENT');
    if (crossProvisioner && !request.crossProvisioner) blockers.push('CROSS_PROVISIONER_UNCONFIRMED');

    const from = record.parentOrganisation ?? {};
    const plan: MovePlan = {
      tournamentId,
      tournamentName: record.tournamentName,
      from: {
        providerId: fromProviderId,
        organisationName: from.organisationName,
        organisationAbbreviation: from.organisationAbbreviation,
      },
      to: {
        providerId: toProviderId,
        organisationName: destination.organisationName,
        organisationAbbreviation: destination.organisationAbbreviation,
      },
      calendarListed: isCalendarListed(record),
      accessRows: {
        assignments: oldAssignments.map(({ userId, email, assignmentRole }) => ({ userId, email, assignmentRole })),
        grants: oldGrants.map(({ grantId, userId, capability }) => ({ grantId, userId, capability })),
      },
      provisioner: {
        crossProvisioner,
        tournamentProvisioner: mapping
          ? { provisionerId: mapping.provisionerId, providerId: mapping.providerId }
          : null,
        after: mappingAfter,
      },
      blockers,
    };
    return { plan, record, destination };
  }

  /** Runs inside the tournament lock and the durable command's transaction. */
  private async applyMove(request: MoveProviderRequest & { reason: string }, userContext: UserContext) {
    const planned = await this.planMove(request);
    if (planned.error) return planned;
    const { plan, record, destination } = planned as { plan: MovePlan; record: any; destination: any };
    if (plan.blockers.length) return fail('MOVE_BLOCKED', { blockers: plan.blockers, plan });

    const { tournamentId } = plan;

    // D2: the old provider's access goes with the move, never along with the tournament into the new provider.
    for (const a of plan.accessRows.assignments) await this.assignments.revoke(tournamentId, a.userId);
    for (const g of plan.accessRows.grants) await this.grants.revoke(g.grantId);

    // The record. `provisionerOrigin` (an extension on parentOrganisation) is kept by the merge: it is history (D3).
    const movedAt = new Date().toISOString();
    record.parentOrganisation = movedParentOrganisation(record.parentOrganisation, destination);
    appendProviderMove(record, {
      fromProviderId: plan.from.providerId,
      fromAbbreviation: plan.from.organisationAbbreviation,
      toProviderId: plan.to.providerId,
      toAbbreviation: plan.to.organisationAbbreviation,
      movedAt,
      movedBy: userContext.userId,
      reason: request.reason,
      commandId: request.commandId,
    });

    const tournamentRecords = { [tournamentId]: record };
    const saved: any = await this.tournamentStorageService.saveTournamentRecords({
      tournamentRecords,
      projectionMode: 'snapshot',
      userId: userContext.userId,
    });
    if (!saved?.success) return saved?.error ? saved : fail('SAVE_FAILED');

    // The save re-derives a LISTED record's calendar row, moving it (tournament_id is the key). An unlisted record is
    // not touched by the save, so a row it may still have would stay on the OLD provider's calendar.
    if (!plan.calendarListed) {
      await this.tournamentStorageService.removeFromCalendar({ providerId: plan.from.providerId, tournamentId });
    }

    if (plan.provisioner.tournamentProvisioner) {
      if (plan.provisioner.after) await this.tournamentProvisioners.reassign(tournamentId, plan.provisioner.after);
      else await this.tournamentProvisioners.remove(tournamentId);
    }

    // A wholesale replace raises no notices: the read model learns of the move only through this snapshot.
    const deltas = await this.snapshotProjection.enqueueSnapshots({ tournamentRecords, source: 'admin-provider-move' });

    await this.auditService.recordProviderMove({
      tournamentId,
      userId: userContext.userId,
      userEmail: userContext.email,
      reason: request.reason,
      commandId: request.commandId!,
      before: {
        providerId: plan.from.providerId,
        organisationAbbreviation: plan.from.organisationAbbreviation,
        tournamentProvisioner: plan.provisioner.tournamentProvisioner,
      },
      after: {
        providerId: plan.to.providerId,
        organisationAbbreviation: plan.to.organisationAbbreviation,
        tournamentProvisioner: plan.provisioner.after,
        revokedAssignments: plan.accessRows.assignments.length,
        revokedGrants: plan.accessRows.grants.length,
      },
    });

    // D4, after the commit: a rolled-back move must not send open clients to reload.
    const serverUpdatedAt = saved.serverUpdatedAt?.[tournamentId];
    await afterCommandCommit(async () =>
      this.broadcastService.broadcastTournamentReplaced(tournamentId, { reason: MOVE_REASON, serverUpdatedAt }),
    );

    return { success: true, tournamentId, plan, deltas, serverUpdatedAt };
  }
}

function appendProviderMove(record: any, move: Record<string, any>): void {
  const extensions: any[] = (record.extensions ??= []);
  const existing = extensions.find((e) => e?.name === PROVIDER_MOVES_EXTENSION);
  if (existing) existing.value = [...(Array.isArray(existing.value) ? existing.value : []), move];
  else extensions.push({ name: PROVIDER_MOVES_EXTENSION, value: [move] });
}
