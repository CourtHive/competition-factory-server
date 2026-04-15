export const PROVISIONER_PROVIDER_STORAGE = Symbol('PROVISIONER_PROVIDER_STORAGE');

/**
 * Storage interface for provisioner↔provider associations.
 * Tracks which provisioners manage which providers, and the relationship type
 * (owner vs subsidiary).
 */
export interface IProvisionerProviderStorage {
  /** Get all provider associations for a provisioner. */
  findByProvisioner(provisionerId: string): Promise<ProvisionerProviderRow[]>;

  /** Get all provisioner associations for a provider. */
  findByProvider(providerId: string): Promise<ProvisionerProviderRow[]>;

  /** Get the relationship type between a provisioner and provider, or null if none. */
  getRelationship(provisionerId: string, providerId: string): Promise<'owner' | 'subsidiary' | null>;

  /** Create an association. */
  associate(
    provisionerId: string,
    providerId: string,
    relationship: 'owner' | 'subsidiary',
    grantedBy?: string,
  ): Promise<{ success: boolean }>;

  /** Update an existing association's relationship type. */
  updateRelationship(
    provisionerId: string,
    providerId: string,
    relationship: 'owner' | 'subsidiary',
  ): Promise<{ success: boolean }>;

  /** Remove an association. */
  disassociate(provisionerId: string, providerId: string): Promise<{ success: boolean }>;
}

export interface ProvisionerProviderRow {
  provisionerId: string;
  providerId: string;
  relationship: 'owner' | 'subsidiary';
  grantedBy?: string;
  createdAt?: string;
}
