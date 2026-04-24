export const PROVIDER_STORAGE = Symbol('PROVIDER_STORAGE');

export interface IProviderStorage {
  getProvider(providerId: string): Promise<any>;
  getProviders(): Promise<{ key: string; value: any }[]>;
  setProvider(providerId: string, provider: any): Promise<{ success: boolean }>;
  removeProvider(providerId: string): Promise<{ success: boolean }>;
  updateLastAccess(providerId: string): Promise<void>;
}
