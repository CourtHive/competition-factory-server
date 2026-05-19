export const POLICY_STORAGE = Symbol('POLICY_STORAGE');

export type PolicyVisibility = 'PROVIDER_PRIVATE' | 'SHARED_DEMO' | 'TEMPLATE_REF';

export interface PolicyRecord {
  policyId: string;
  providerId: string | null;
  policyType: string;
  name: string;
  version: string;
  visibility: PolicyVisibility;
  definition: any;
  metadata?: any;
  publishedAt: Date;
  publishedBy?: string | null;
}

export interface SavePolicyInput {
  policyId: string;
  providerId: string | null;
  policyType: string;
  name: string;
  version: string;
  visibility: PolicyVisibility;
  definition: any;
  metadata?: any;
  publishedBy?: string | null;
}

export interface GetPolicyArgs {
  policyType: string;
  name: string;
  version?: string;
  providerId?: string | null;
}

export interface ListPoliciesArgs {
  providerId?: string | null;
  visibilities?: PolicyVisibility[];
  policyType?: string;
  includeGlobal?: boolean;
}

export interface IPolicyStorage {
  savePolicy(input: SavePolicyInput): Promise<{ success?: boolean; error?: string }>;

  getPolicy(args: GetPolicyArgs): Promise<{ policy?: PolicyRecord; error?: string }>;

  findById(policyId: string): Promise<{ policy?: PolicyRecord; error?: string }>;

  listPolicies(args: ListPoliciesArgs): Promise<{ policies?: PolicyRecord[]; error?: string }>;

  deletePolicy(args: { policyId: string }): Promise<{ success?: boolean; error?: string }>;
}
