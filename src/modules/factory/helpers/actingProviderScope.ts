import type { UserContext } from 'src/modules/account/auth/decorators/user-context.decorator';

/**
 * MAY THIS SESSION TOUCH A TOURNAMENT OF `providerId`? (Mentat/planning/MULTI_PROVIDER_CONTEXT_COMPLETION.md)
 *
 * A session acts for ONE provider: the token's `providerId` claim, which a user with several providers chose
 * at login. CA, 2026-10-06: a session for provider A may not touch the user's provider-B tournaments; to work
 * there they switch, which issues a session for B. So membership in the user's providers is necessary but no
 * longer sufficient.
 *
 * - super-admin: any provider.
 * - a session that still has to choose (`providerSelectionPending`): none.
 * - a session with a chosen provider: that provider only.
 * - a session with no provider claim at all (a provisioner without associations, a token minted before the
 *   two-step login): unchanged, gated by `checkProvider`'s membership test as before.
 */
export function actingProviderAllows(userContext: UserContext | undefined, providerId: string): boolean {
  if (!userContext || userContext.isSuperAdmin) return true;
  if (userContext.providerSelectionPending) return false;
  if (!userContext.actingProviderId) return true;
  return userContext.actingProviderId === providerId;
}
