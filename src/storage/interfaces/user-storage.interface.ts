export const USER_STORAGE = Symbol('USER_STORAGE');

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
}
