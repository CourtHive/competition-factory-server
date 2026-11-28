/**
 * Activating a sanctioned tournament: building the tournamentRecord from an APPROVED sanctioning record, storing it,
 * and telling courthive-ams the record is ACTIVE.
 *
 * Two paths reach it. The first accepted registration for a proposal whose registration opened before the tournament
 * existed (RegistrationsService.ensureActivated), and the provider administrator's "Activate (Create Tournament)" in
 * the AMS console (SanctioningActivationService). Only CFS stores tournaments, so both run here; AMS's own execute
 * route refuses `activateFromSanctioning`, which used to mark the record ACTIVE and discard the tournament it built.
 *
 * CA, 2026-11-11: the governing body is the provider that owns the sanctioned tournament; its non-admin users apply
 * and its PROVIDER_ADMIN reviews. So the owner is `governingBodyId`, and activation from the console is the reviewer's.
 */
import { BadRequestException, type Logger } from '@nestjs/common';
import * as factory from 'tods-competition-factory';

import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import type { UserContext } from '../auth/decorators/user-context.decorator';
import { withTournamentLock } from 'src/services/tournamentMutex';
import { PROVIDER_ADMIN } from 'src/common/constants/roles';

import type { SanctioningClient, SanctioningRecordSnapshot } from './sanctioning-client.service';

/** The provider that owns a sanctioned tournament: its governing body. `governingBody` only describes it. */
export function owningProviderOf(sanctioningRecord: SanctioningRecordSnapshot): string {
  return sanctioningRecord.governingBodyId ?? sanctioningRecord.governingBody?.organisationId ?? '';
}

/**
 * Whether the caller may activate for the provider (super-admin, a direct provider role, or a provisioner-managed
 * provider). Mirrors the provider dimension of canMutateTournament, since no tournamentRecord exists yet to gate
 * against. The first accepted registration is a director's act, so any role at the provider qualifies.
 */
export function canActivateForProvider(userContext: UserContext, provider: string): boolean {
  if (userContext.isSuperAdmin) return true;
  if (!provider) return false;
  if (userContext.providerIds?.includes(provider)) return true;
  return !!userContext.provisionerProviderIds?.includes(provider);
}

/** Whether the caller reviews for the provider: its PROVIDER_ADMIN, or a super-admin (CA, 2026-11-11). */
export function canReviewForProvider(userContext: UserContext, provider: string): boolean {
  if (userContext.isSuperAdmin) return true;
  return !!provider && userContext.providerRoles?.[provider] === PROVIDER_ADMIN;
}

// Run the factory `activateFromSanctioning` via the sanctioningEngine. The engine is a module-level singleton (not
// per-request isolated like the tournament mutation engine), so the reset→setState→activate→reset sequence is kept
// strictly SYNCHRONOUS — no awaits — making it atomic under Node's single thread. Callers await the fetch/save AROUND it.
function activateSanctioning(sanctioningRecord: SanctioningRecordSnapshot): { tournamentRecord?: any; error?: any } {
  const engine = factory.sanctioningEngine as any;
  engine.reset();
  engine.setState({ [sanctioningRecord.sanctioningId]: sanctioningRecord });
  engine.setActiveSanctioningId(sanctioningRecord.sanctioningId);
  const result = engine.activateFromSanctioning({});
  engine.reset();
  return result ?? {};
}

type AttachedPolicy = NonNullable<SanctioningRecordSnapshot['attachedPolicies']>[number];

/**
 * The value a sanctioned policy is pinned with: its full definition plus where it came from. `policyName` and
 * `policyVersion` are AMS's catalogue name and version (the factory keeps both on a pinned value), and `policySource` is
 * the rulebook or provider AMS resolved it from. A field AMS did not send is left out, never invented. A definition with
 * nothing in it gets no provenance either: the factory refuses an empty policy, and a name and version alone must not
 * make one look like content.
 */
export function pinnedPolicyValue({ definition, name, version, sourceId, sourceRole }: AttachedPolicy): any {
  const empty = !definition || !Object.values(definition).some((value) => value !== undefined);
  if (empty) return { ...definition };
  return {
    ...definition,
    ...(name ? { policyName: name } : {}),
    ...(version ? { policyVersion: version } : {}),
    ...(sourceId || sourceRole
      ? { policySource: { ...(sourceId ? { sourceId } : {}), ...(sourceRole ? { sourceRole } : {}) } }
      : {}),
  };
}

/**
 * Warns when AMS decided which policies differ from the defaults against other defaults than the ones this tournament
 * was created with. A policy AMS found equal to its default was not sent, and here that default is different. Only
 * with a factory that stamps its defaults, and an AMS that recorded them; otherwise there is nothing to compare.
 */
function warnOnDefaultsMismatch(tournamentRecord: any, sanctioningRecord: SanctioningRecordSnapshot, logger: Logger) {
  const compared = sanctioningRecord.attachedPoliciesDefaults?.defaultsHash;
  const stamped = tournamentRecord?.factory?.defaultsHash ?? (factory as any).defaultsHash;
  if (!compared || typeof stamped !== 'string' || compared === stamped) return;
  logger.warn(
    `tournament ${tournamentRecord?.tournamentId}: sanctioning compared its policies with factory defaults ${compared}` +
      ` (factory ${sanctioningRecord.attachedPoliciesDefaults?.factoryVersion ?? 'unknown'}); this tournament relies on ${stamped}`,
  );
}

/**
 * Apply the policies AMS resolved when the record was approved.
 *
 * AMS owns WHICH policies apply — the rulebook's outrank the provider's, and only policies differing from factory
 * defaults are sent — so this applies what it is given and decides nothing. `rankingPoints` never arrives here by
 * construction. Each is pinned by its full value with its name, version and source (`pinnedPolicyValue`).
 *
 * Applied before the first save so the tournament is persisted with its policies already on it. Failures are logged
 * rather than thrown: a tournament that activates without an optional policy override is recoverable; one that fails
 * to activate blocks the first accepted registration.
 */
export function attachSanctionedPolicies(
  tournamentRecord: any,
  sanctioningRecord: SanctioningRecordSnapshot,
  logger: Logger,
): void {
  warnOnDefaultsMismatch(tournamentRecord, sanctioningRecord, logger);
  const attached = sanctioningRecord.attachedPolicies;
  if (!attached?.length) return;

  const policyDefinitions = Object.assign(
    {},
    ...attached.map((policy) => ({ [policy.policyType]: pinnedPolicyValue(policy) })),
  );

  // the record is not in the engine's state: the governor writes to the record given, which is then saved (an engine
  // call works only on the records it holds)
  const result: any = factory.policyGovernor.attachPolicies({ tournamentRecord, policyDefinitions });
  if (result?.error) {
    logger.warn(
      `tournament ${tournamentRecord?.tournamentId}: could not attach sanctioned policies — ${result.error?.message ?? result.error}`,
    );
    return;
  }
  logger.log(
    `tournament ${tournamentRecord?.tournamentId}: attached ${attached.length} sanctioned policy definition(s) (${attached
      .map((p) => p.policyType)
      .join(', ')})`,
  );
}

/**
 * Tell AMS the tournament exists, so the record reads ACTIVE. Best effort: the tournament is stored either way, AMS
 * answers a repeat for the same tournament with success, and the console's activate re-sends it for a tournament that
 * already exists, so a missed notification is recoverable where an activation that failed on it would not be.
 */
export async function notifyActivated(
  sanctioningClient: SanctioningClient,
  sanctioningId: string,
  tournamentId: string,
  logger: Logger,
): Promise<boolean> {
  try {
    await sanctioningClient.markActivated(sanctioningId, tournamentId);
    return true;
  } catch (err: any) {
    logger.warn(
      `sanctioning ${sanctioningId}: AMS not told tournament ${tournamentId} is active — ${err?.message ?? err}`,
    );
    return false;
  }
}

/**
 * Build the tournament from an APPROVED record, attach its sanctioned policies and store it under the tournament
 * lock, then tell AMS. Authorization is the caller's: the two paths admit different people.
 *
 * Under the lock, re-checked: two activations racing here must not both write, and an executionQueue must never
 * interleave its fetch and save with this one. `created: false` when another activation stored it first.
 */
export async function storeActivatedTournament(args: {
  sanctioningRecord: SanctioningRecordSnapshot;
  userId?: string;
  tournamentStorageService: TournamentStorageService;
  sanctioningClient: SanctioningClient;
  logger: Logger;
}): Promise<{ tournamentId: string; created: boolean }> {
  const { sanctioningRecord, userId, tournamentStorageService, sanctioningClient, logger } = args;

  const activated = activateSanctioning(sanctioningRecord);
  if (!activated?.tournamentRecord) {
    throw new BadRequestException(
      `Could not activate tournament from sanctioning record: ${JSON.stringify(activated?.error ?? 'unknown error')}`,
    );
  }
  const tournamentId: string = activated.tournamentRecord.tournamentId;

  attachSanctionedPolicies(activated.tournamentRecord, sanctioningRecord, logger);

  const saveResult: any = await withTournamentLock([tournamentId], async () => {
    const raced = await tournamentStorageService.findTournamentRecord({ tournamentId });
    if (raced?.tournamentRecord) return { success: true, raced: true };
    return tournamentStorageService.saveTournamentRecord({ tournamentRecord: activated.tournamentRecord, userId });
  });
  if (saveResult?.raced) return { tournamentId, created: false };
  if (saveResult?.error) {
    throw new BadRequestException(`Failed to persist activated tournament: ${saveResult.error}`);
  }

  logger.log(`activated tournamentRecord ${tournamentId} from sanctioning ${sanctioningRecord.sanctioningId}`);
  await notifyActivated(sanctioningClient, sanctioningRecord.sanctioningId, tournamentId, logger);
  return { tournamentId, created: true };
}
