export const PROVIDER_STORAGE = Symbol('PROVIDER_STORAGE');

export interface IProviderStorage {
  getProvider(providerId: string): Promise<any | null>;
  getProviders(): Promise<{ key: string; value: any }[]>;
  setProvider(providerId: string, provider: any): Promise<{ success: boolean }>;
}
