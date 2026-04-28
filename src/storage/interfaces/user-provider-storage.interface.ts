export const USER_PROVIDER_STORAGE = Symbol('USER_PROVIDER_STORAGE');

/**
 * Storage interface for user↔provider associations.
 * Each row represents a user's role at a specific provider.
 * A user with rows for multiple provider_ids is multi-provider.
 */
export interface IUserProviderStorage {
  /** Get all provider associations for a user (by user_id UUID). */
  findByUserId(userId: string): Promise<UserProviderRow[]>;

  /**
   * Same as `findByUserId` but joined with `providers` so each row
   * carries `organisationName` + `organisationAbbreviation` for display.
   * When `allowedProviderIds` is provided the result is filtered to
   * only those providers — used to scope a non-super-admin editor's
   * view of a user's affiliations to providers they administer.
   */
  findByUserIdEnriched(
    userId: string,
    allowedProviderIds?: string[],
  ): Promise<UserProviderEnrichedRow[]>;

  /** Get all provider associations for a user (by email — resolves to user_id internally). */
  findByEmail(email: string): Promise<UserProviderRow[]>;

  /** Get all users associated with a provider. */
  findByProviderId(providerId: string): Promise<UserProviderRow[]>;

  /** Get a single association. */
  findOne(userId: string, providerId: string): Promise<UserProviderRow | null>;

  /** Create or update an association. */
  upsert(row: UserProviderRow): Promise<{ success: boolean }>;

  /** Remove an association. */
  remove(userId: string, providerId: string): Promise<{ success: boolean }>;
}

export interface UserProviderRow {
  userId: string;
  providerId: string;
  providerRole: 'PROVIDER_ADMIN' | 'DIRECTOR' | string;
  createdAt?: string;
  updatedAt?: string;
  /** Convenience: populated by some queries that join with users table. */
  email?: string;
}

/**
 * UserProviderRow enriched with the provider's display fields, returned
 * by `findByUserIdEnriched` for the admin Edit-User UI.
 */
export interface UserProviderEnrichedRow extends UserProviderRow {
  organisationName: string;
  organisationAbbreviation: string;
}
