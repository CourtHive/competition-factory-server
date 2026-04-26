export const PROVISIONER_STORAGE = Symbol('PROVISIONER_STORAGE');

/**
 * Storage interface for provisioner entity management.
 * Provisioners are M2M entities authenticated via API key, not user accounts.
 */
export interface IProvisionerStorage {
  /** Get a provisioner by ID. */
  getProvisioner(provisionerId: string): Promise<ProvisionerRow | null>;

  /** Get a provisioner by name. */
  findByName(name: string): Promise<ProvisionerRow | null>;

  /** List all provisioners. */
  findAll(): Promise<ProvisionerRow[]>;

  /** Create a provisioner. Returns the generated ID. */
  create(provisioner: Omit<ProvisionerRow, 'provisionerId' | 'createdAt' | 'updatedAt'>): Promise<ProvisionerRow>;

  /** Update provisioner fields. */
  update(provisionerId: string, data: Partial<Pick<ProvisionerRow, 'name' | 'isActive' | 'config'>>): Promise<{ success: boolean }>;

  /** Deactivate a provisioner (soft-delete). */
  deactivate(provisionerId: string): Promise<{ success: boolean }>;

  /**
   * Hard-delete a provisioner and cascade related rows in a single transaction.
   * Removes:
   *  - provisioner_api_keys for this provisioner
   *  - provisioner_providers associations (does NOT delete the providers themselves)
   *  - tournament_provisioner ownership stamps (does NOT delete the tournaments)
   *  - the provisioners row
   * Returns the cascade counts so callers can audit / surface them.
   */
  deleteWithCascade(provisionerId: string): Promise<CascadeCounts>;
}

export interface CascadeCounts {
  apiKeys: number;
  providerAssociations: number;
  tournamentStamps: number;
}

export interface ProvisionerRow {
  provisionerId: string;
  name: string;
  isActive: boolean;
  config: Record<string, any>;
  createdAt?: string;
  updatedAt?: string;
}
