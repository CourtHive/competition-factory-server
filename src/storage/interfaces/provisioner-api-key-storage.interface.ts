export const PROVISIONER_API_KEY_STORAGE = Symbol('PROVISIONER_API_KEY_STORAGE');

/**
 * Storage interface for provisioner API key management.
 * Multiple keys per provisioner for zero-downtime rotation.
 */
export interface IProvisionerApiKeyStorage {
  /** Look up an active, non-expired key by its hash. Returns the key and its provisioner. */
  findByKeyHash(hash: string): Promise<{ key: ProvisionerApiKeyRow; provisionerName: string; provisionerConfig: Record<string, any> } | null>;

  /** Create a new API key record. The plaintext key is NOT stored — only the hash. */
  create(key: Omit<ProvisionerApiKeyRow, 'keyId' | 'createdAt' | 'lastUsedAt'>): Promise<ProvisionerApiKeyRow>;

  /** Revoke a key (set is_active = false). */
  revoke(keyId: string): Promise<{ success: boolean }>;

  /** List all keys for a provisioner (metadata only, no hashes). */
  listByProvisioner(provisionerId: string): Promise<ProvisionerApiKeyRow[]>;

  /** Update last_used_at timestamp. */
  updateLastUsed(keyId: string): Promise<void>;
}

export interface ProvisionerApiKeyRow {
  keyId: string;
  provisionerId: string;
  apiKeyHash: string;
  label?: string;
  isActive: boolean;
  lastUsedAt?: string;
  createdAt?: string;
  expiresAt?: string;
}
