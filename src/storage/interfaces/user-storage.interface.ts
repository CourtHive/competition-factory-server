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
}
