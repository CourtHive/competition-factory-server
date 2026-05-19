import { PolicyVisibility } from 'src/storage/interfaces/policy-storage.interface';

export interface SavePolicyDto {
  providerId: string | null;
  policyType: string;
  name: string;
  version: string;
  visibility: PolicyVisibility;
  definition: any;
  metadata?: any;
}
