export const PROVIDER_STORAGE = Symbol('PROVIDER_STORAGE');

export interface IProviderStorage {
  getProvider(providerId: string): Promise<any>;
  getProviders(): Promise<{ key: string; value: any }[]>;
  setProvider(providerId: string, provider: any): Promise<{ success: boolean }>;
  removeProvider(providerId: string): Promise<{ success: boolean }>;
  updateLastAccess(providerId: string): Promise<void>;

  /**
   * Set last_access on the provider that owns `tournamentId`. Used by
   * tournament-driven access tracking (joinTournament) so the provider
   * whose tournament was actually loaded gets credit — not the user's
   * home provider, which would miss multi-provider users entirely.
   * No-op when the tournament has no resolvable provider.
   */
  updateLastAccessByTournament(tournamentId: string): Promise<void>;

  /**
   * Surgical update of just the caps/settings tier of a provider's
   * config, leaving the rest of the provider record untouched. Used
   * by `PUT /provisioner/providers/:id/caps` and `PUT /provider/:id/settings`.
   */
  updateProviderCaps(providerId: string, caps: any): Promise<{ success: boolean }>;
  updateProviderSettings(providerId: string, settings: any): Promise<{ success: boolean }>;
}
