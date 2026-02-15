export const USER_STORAGE = Symbol('USER_STORAGE');

export interface IUserStorage {
  findOne(email: string): Promise<any | null>;
  create(user: { email: string; password: string; [key: string]: any }): Promise<any>;
  update(email: string, data: any): Promise<{ success: boolean }>;
  remove(email: string): Promise<{ success: boolean }>;
  findAll(): Promise<{ success: boolean; users?: any[]; message?: string }>;
}
