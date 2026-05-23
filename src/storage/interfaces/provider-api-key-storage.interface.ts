export const PROVIDER_API_KEY_STORAGE = Symbol('PROVIDER_API_KEY_STORAGE');

/**
 * Storage interface for provider-scoped API key management.
 *
 * Distinct from `IProvisionerApiKeyStorage`: a provider key authenticates
 * as a single provider and has no provisioner wrapper. Multiple keys per
 * provider so callers can rotate without downtime. Key prefix: `pkey_live_`.
 */
export interface IProviderApiKeyStorage {
  /** Look up an active, non-expired key by its hash. Returns the key and its provider. */
  findByKeyHash(hash: string): Promise<{ key: ProviderApiKeyRow; providerName: string; providerConfig: Record<string, any> } | null>;

  /** Create a new API key record. The plaintext key is NOT stored — only the hash. */
  create(key: Omit<ProviderApiKeyRow, 'keyId' | 'createdAt' | 'lastUsedAt'>): Promise<ProviderApiKeyRow>;

  /** Revoke a key (set is_active = false). */
  revoke(keyId: string): Promise<{ success: boolean }>;

  /** List all keys for a provider (metadata only, no hashes). */
  listByProvider(providerId: string): Promise<ProviderApiKeyRow[]>;

  /** Update last_used_at timestamp. */
  updateLastUsed(keyId: string): Promise<void>;
}

export interface ProviderApiKeyRow {
  keyId: string;
  providerId: string;
  apiKeyHash: string;
  label?: string;
  isActive: boolean;
  lastUsedAt?: string;
  createdAt?: string;
  expiresAt?: string;
}
