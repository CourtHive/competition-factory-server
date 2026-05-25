export const AUTH_CODE_STORAGE = Symbol('AUTH_CODE_STORAGE');

export interface IAuthCodeStorage {
  getResetCode(code: string): Promise<any | null>;
  setResetCode(code: string, value: any): Promise<{ success: boolean }>;
  deleteResetCode(code: string): Promise<{ success: boolean }>;

  /**
   * Store a single-use access code (magic-link login). `expiresAt` is an ISO
   * timestamp after which the code is invalid.
   */
  setAccessCode(code: string, email: string, expiresAt: string): Promise<{ success: boolean }>;

  /**
   * Atomically consume an access code: returns the associated email and
   * deletes the row in one statement (single-use), but only if the code
   * exists and has not expired. Returns null otherwise.
   */
  consumeAccessCode(code: string): Promise<string | null>;
}
