export const USER_PROVISIONER_STORAGE = Symbol('USER_PROVISIONER_STORAGE');

/**
 * Storage interface for user↔provisioner associations (Phase 2A).
 * A user with the PROVISIONER global role represents one or more
 * provisioner organizations and can call /provisioner/* endpoints
 * via JWT (in addition to the existing API-key path).
 */
export interface IUserProvisionerStorage {
  /** All provisioner IDs this user represents. */
  findProvisionerIdsByUser(userId: string): Promise<string[]>;

  /** All users associated with a provisioner. */
  findUsersByProvisioner(provisionerId: string): Promise<UserProvisionerRow[]>;

  /** Create the association. Idempotent (ON CONFLICT DO NOTHING). */
  associate(userId: string, provisionerId: string, grantedBy?: string): Promise<{ success: boolean }>;

  /** Remove the association. */
  disassociate(userId: string, provisionerId: string): Promise<{ success: boolean }>;
}

export interface UserProvisionerRow {
  userId: string;
  provisionerId: string;
  grantedBy?: string;
  createdAt?: string;
}
