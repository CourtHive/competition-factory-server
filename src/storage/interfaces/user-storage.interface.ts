export const USER_STORAGE = Symbol('USER_STORAGE');

/**
 * Cached canonical fields denormalized onto the `users` row from
 * courthive-persons. Keeps the public surface resilient when persons
 * is briefly unreachable. Refreshed on `personMerged` events or when
 * `person_revision` mismatches.
 */
export interface CachedPersonFields {
  standardFamilyName?: string | null;
  standardGivenName?: string | null;
  birthDate?: string | null;
  sex?: string | null;
  nationalityCode?: string | null;
}

/**
 * Linkage from a CFS `users` row to a canonical courthive-persons row.
 * `personId` is a LOGICAL FK (persons lives in a separate database per
 * the Option-A decision 2026-05-30); validation happens here at the
 * application layer, not via a Postgres `REFERENCES` constraint.
 */
export interface UserPersonLink {
  userId: string;
  personId: string | null;
  personRevision: number | null;
  cached: CachedPersonFields;
}

export interface IUserStorage {
  findOne(email: string): Promise<any | null>;
  create(user: { email: string; password: string; [key: string]: any }): Promise<any>;
  update(email: string, data: any): Promise<{ success: boolean }>;
  remove(email: string): Promise<{ success: boolean }>;
  findAll(): Promise<{ success: boolean; users?: any[]; message?: string }>;
  updateLastAccess(email: string): Promise<void>;
  /**
   * Persist the user's last-selected provider for multi-provider session
   * context. Pass `null` to clear. Called by PATCH /auth/me/last-selected-
   * provider after the controller has validated the providerId is in the
   * user's user_providers associations.
   */
  updateLastSelectedProviderId(email: string, providerId: string | null): Promise<{ success: boolean }>;
  /**
   * Atomic one-query operation for /auth/complete-first-login: writes the
   * new hashed password and clears `must_change_password` in a single
   * UPDATE. Avoids a read-modify-write that would race with concurrent
   * field updates on the same row.
   */
  completeFirstLogin(email: string, hashedPassword: string): Promise<{ success: boolean }>;
  /**
   * Case-insensitive lookup by contact_email — used by the eventual
   * forgot-password flow (B3) to find a user from the contact address
   * they typed. Returns the same shape as `findOne`.
   */
  findByContactEmail(contactEmail: string): Promise<any | null>;
  /**
   * Write a new contact email and CLEAR `email_verified_at` atomically.
   * Re-verification is required after any change — otherwise a session
   * holder could swap to an address they don't control and inherit
   * the previous verified-state.
   */
  setContactEmail(userId: string, contactEmail: string): Promise<{ success: boolean }>;
  /**
   * Stamp `email_verified_at = NOW()` after the user clicks the link in
   * the verification email. The verify endpoint calls this on
   * successful token validation.
   */
  markEmailVerified(userId: string): Promise<{ success: boolean }>;
  /**
   * Look up a user by uuid primary key. Used by the B3 password-reset
   * flow which carries `userId` in the reset token rather than `email`
   * (the login id can change in principle; userId is stable).
   */
  findByUserId(userId: string): Promise<any | null>;
  /**
   * Atomic password write keyed by `userId`. Also clears
   * `must_change_password` because a successful password reset is an
   * explicit user-initiated set — no need to force them to change it
   * again on next login.
   */
  setPasswordByUserId(userId: string, hashedPassword: string): Promise<{ success: boolean }>;
  /**
   * Aggregate counters for the contact_email backfill nudge tile:
   * how many users have a verified recovery mailbox, how many are
   * pending verification, how many lack one entirely, and how many
   * have contact_email === email (likely-fake mailbox, since email
   * is the login id and is often not a real address).
   */
  getContactEmailCoverage(): Promise<{
    total: number;
    missing: number;
    equalsLogin: number;
    verified: number;
    unverified: number;
  }>;
  /**
   * HiveID linkage write. Sets `person_id`, the cached canonical fields,
   * and `person_revision` in a single UPDATE keyed by `userId`. Callers
   * are responsible for having already resolved the personId against
   * courthive-persons (via `POST /persons/resolve` or similar). The
   * logical FK is NOT enforced by Postgres — persons lives in a
   * separate database per the Option-A decision 2026-05-30.
   */
  setPersonLink(
    userId: string,
    args: { personId: string; personRevision: number; cached: CachedPersonFields },
  ): Promise<{ success: boolean }>;
  /**
   * HiveID linkage read. Returns the user's canonical-Person link + cached
   * fields, or null when the user does not exist. A linked-but-not-yet-
   * resolved row returns `{ personId: null, personRevision: null, cached: {} }`.
   */
  getPersonLink(userId: string): Promise<UserPersonLink | null>;
  /**
   * Rewrite all users whose `person_id` matches `fromPersonId` to point
   * at `toPersonId`, stamping the new `personRevision` + cached fields
   * in the same UPDATE. Called by `PersonsClient` on every
   * `personMerged` SSE event so locally-cached canonical fields stay
   * in sync with the canonical Person registry.
   *
   * Returns the number of rows rewritten — usually 0 or 1 (one human
   * has at most one users row), but the surface tolerates many.
   */
  rewritePersonId(args: {
    fromPersonId: string;
    toPersonId: string;
    personRevision: number;
    cached: CachedPersonFields;
  }): Promise<{ rewrittenCount: number }>;
}
