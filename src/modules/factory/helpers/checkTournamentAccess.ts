/**
 * Per-user tournament visibility and mutation access control.
 *
 * Mirrors the pattern in sanctioning/helpers/checkSanctioningAccess.ts.
 * All access decisions flow through this file so there is a single
 * authoritative decision point. Gated by ENABLE_TOURNAMENT_ACCESS_SCOPING;
 * when the flag is off, every check returns true (legacy behavior).
 *
 * Terminology:
 *   - "view" = can the user see this tournament in their calendar / fetch it?
 *   - "mutate" = can the user save / execute mutations against this tournament?
 *
 * Rules (Phase 0):
 *   SUPER_ADMIN → all tournaments at all providers.
 *   PROVIDER_ADMIN at provider P → all tournaments where parentOrganisation.organisationId === P.
 *   DIRECTOR at provider P → tournaments where parentOrganisation.organisationId === P AND
 *       (createdByUserId === userContext.userId OR an assignment row exists for the tournament).
 *   No user_providers row for the tournament's provider → no access.
 *   Legacy tournaments (createdByUserId absent) → visible to SUPER_ADMIN and PROVIDER_ADMIN only.
 */
import { isTournamentAccessScopingEnabled } from 'src/common/constants/feature-flags';
import { PROVIDER_ADMIN } from 'src/common/constants/roles';
import type { UserContext } from 'src/modules/auth/decorators/user-context.decorator';

/** Extension name used on tournament records to store the creating user's UUID. */
export const CREATED_BY_USER_ID = 'createdByUserId';

// ── Helpers ──

function getTournamentProviderId(tournament: any): string | undefined {
  return tournament?.parentOrganisation?.organisationId;
}

function getCreatedByUserId(tournament: any): string | undefined {
  const extensions: any[] = tournament?.extensions ?? [];
  const ext = extensions.find((e) => e?.name === CREATED_BY_USER_ID);
  return ext?.value;
}

// ── Public API ──

/**
 * Can this user see this tournament?
 *
 * @param tournament - The tournament record (needs parentOrganisation + extensions).
 * @param userContext - The multi-provider user context from the middleware.
 * @param assignedTournamentIds - Set of tournament IDs the user has been
 *   explicitly granted access to (pre-resolved by the caller from IAssignmentStorage).
 *   Pass an empty set if assignments haven't been loaded.
 */
export function canViewTournament(
  tournament: any,
  userContext: UserContext | undefined,
  assignedTournamentIds: Set<string> = new Set(),
): boolean {
  if (!isTournamentAccessScopingEnabled()) return true;
  if (!userContext) return false;
  if (userContext.isSuperAdmin) return true;

  const providerId = getTournamentProviderId(tournament);
  if (!providerId) return true; // No provider → unscoped tournament (demo/sandbox), always visible.

  const roleAtProvider = userContext.providerRoles[providerId];
  if (!roleAtProvider) return false; // User has no association with this provider.

  if (roleAtProvider === PROVIDER_ADMIN) return true;

  // DIRECTOR: must own or be assigned.
  const tournamentId = tournament?.tournamentId;
  const createdBy = getCreatedByUserId(tournament);

  if (createdBy && createdBy === userContext.userId) return true;
  if (tournamentId && assignedTournamentIds.has(tournamentId)) return true;

  // Legacy tournament (no createdByUserId) — hidden from directors.
  return false;
}

/**
 * Can this user mutate (save / execute methods against) this tournament?
 *
 * Phase 0: same rules as view. Phase 1 will add assignment_role-based
 * method classification (OBSERVER cannot mutate, SCORER limited, etc.).
 */
export function canMutateTournament(
  tournament: any,
  userContext: UserContext | undefined,
  assignedTournamentIds: Set<string> = new Set(),
): boolean {
  return canViewTournament(tournament, userContext, assignedTournamentIds);
}

/**
 * Filter a list of tournament calendar entries to only those the user can see.
 *
 * Each entry must have at minimum `{ tournamentId, providerId }` and
 * optionally a `createdByUserId` field (projected by getCalendarEntry).
 */
export function scopeCalendarForUser(
  tournaments: any[],
  userContext: UserContext | undefined,
  assignedTournamentIds: Set<string> = new Set(),
): any[] {
  if (!isTournamentAccessScopingEnabled()) return tournaments;
  if (!userContext) return [];
  if (userContext.isSuperAdmin) return tournaments;

  return tournaments.filter((entry) => {
    const providerId = entry?.providerId;
    if (!providerId) return true; // Unscoped entry.

    const roleAtProvider = userContext.providerRoles[providerId];
    if (!roleAtProvider) return false;
    if (roleAtProvider === PROVIDER_ADMIN) return true;

    // DIRECTOR: own or assigned.
    const createdBy = entry?.createdByUserId;
    if (createdBy && createdBy === userContext.userId) return true;
    if (entry?.tournamentId && assignedTournamentIds.has(entry.tournamentId)) return true;

    return false;
  });
}
