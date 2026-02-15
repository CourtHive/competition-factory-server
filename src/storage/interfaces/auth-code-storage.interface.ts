export const AUTH_CODE_STORAGE = Symbol('AUTH_CODE_STORAGE');

export interface IAuthCodeStorage {
  getResetCode(code: string): Promise<any | null>;
  setResetCode(code: string, value: any): Promise<{ success: boolean }>;
  deleteResetCode(code: string): Promise<{ success: boolean }>;
  getAccessCode(code: string): Promise<any | null>;
  setAccessCode(code: string, email: string): Promise<{ success: boolean }>;
}
