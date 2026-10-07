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

/**
 * THE PROVIDER THIS SESSION ACTS FOR — for anything stamped or attributed to a provider (a generated tournament,
 * a pending save). Never `req.user.providerId`: in CFS `req.user` is the DATABASE row, whose providerId is the
 * legacy home column, not what the session chose.
 *
 * - a session that has not chosen: none.
 * - a chosen provider (the token's claim, or the provider a provisioner request names): that one.
 * - otherwise exactly one association: that one (not a choice). Several and no choice: none.
 */
export function sessionProviderId(userContext: UserContext | undefined): string | undefined {
  if (!userContext || userContext.providerSelectionPending) return undefined;
  if (userContext.actingProviderId) return userContext.actingProviderId;
  const ids = userContext.providerIds ?? [];
  return ids.length === 1 ? ids[0] : undefined;
}
