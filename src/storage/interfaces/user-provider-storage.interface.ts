export const USER_PROVIDER_STORAGE = Symbol('USER_PROVIDER_STORAGE');

/**
 * Storage interface for user↔provider associations.
 * Each row represents a user's role at a specific provider.
 * A user with rows for multiple provider_ids is multi-provider.
 */
export interface IUserProviderStorage {
  /** Get all provider associations for a user (by user_id UUID). */
  findByUserId(userId: string): Promise<UserProviderRow[]>;

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
