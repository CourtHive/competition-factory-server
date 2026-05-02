export const TOPOLOGY_STORAGE = Symbol('TOPOLOGY_STORAGE');

export interface TopologyRow {
  topologyId: string;
  providerId: string;
  name: string;
  description?: string | null;
  state: any;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITopologyStorage {
  /** List all topologies authored by a provider, ordered by name. */
  findByProvider(providerId: string): Promise<TopologyRow[]>;

  /** Get a single topology by id, scoped to the owning provider. */
  getOne(providerId: string, topologyId: string): Promise<TopologyRow | null>;

  /** Insert a new topology. The caller supplies the topology id. */
  create(row: Omit<TopologyRow, 'createdAt' | 'updatedAt'>): Promise<TopologyRow>;

  /**
   * Patch name / description / state on an existing topology. Provider
   * scope is enforced here so a request handler can't accidentally
   * mutate another provider's row by id alone.
   */
  update(
    providerId: string,
    topologyId: string,
    patch: Partial<Pick<TopologyRow, 'name' | 'description' | 'state'>>,
  ): Promise<{ success: boolean }>;

  /** Permanent delete. */
  remove(providerId: string, topologyId: string): Promise<{ success: boolean }>;
}
