export const SSO_IDENTITY_STORAGE = Symbol('SSO_IDENTITY_STORAGE');

/**
 * Storage interface for SSO external identity mapping.
 * Maps Competition Factory user_ids to external IdP identifiers,
 * enabling SSO login resolution without email-based identity.
 */
export interface ISsoIdentityStorage {
  /** Look up a user by their external IdP identity. */
  findByExternalId(ssoProvider: string, externalId: string): Promise<SsoIdentityRow | null>;

  /** Get all SSO identities for a user. */
  findByUserId(userId: string): Promise<SsoIdentityRow[]>;

  /** Create an SSO identity mapping. */
  create(identity: Omit<SsoIdentityRow, 'createdAt'>): Promise<{ success: boolean }>;

  /** Update mutable fields (phone, email) on an SSO identity. */
  update(ssoProvider: string, externalId: string, data: Partial<Pick<SsoIdentityRow, 'phone' | 'email'>>): Promise<{ success: boolean }>;

  /** Remove an SSO identity mapping. */
  remove(ssoProvider: string, externalId: string): Promise<{ success: boolean }>;
}

export interface SsoIdentityRow {
  userId: string;
  ssoProvider: string;
  externalId: string;
  phone?: string;
  email?: string;
  createdAt?: string;
}
