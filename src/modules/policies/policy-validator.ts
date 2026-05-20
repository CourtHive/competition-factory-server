import { PolicyVisibility } from 'src/storage/interfaces/policy-storage.interface';

export type PolicyValidationError = { path: string; message: string };

export type PolicyValidationResult = { ok: true } | { ok: false; errors: PolicyValidationError[] };

const VALID_VISIBILITIES: PolicyVisibility[] = ['PROVIDER_PRIVATE', 'SHARED_DEMO', 'TEMPLATE_REF'];
// Accepts semver (1.0.0), short semver (1.0), and date-style versions
// (2026.01, 2026.01.05) which are common in federation policy documents.
// Optional pre-release suffix is allowed: 1.0.0-beta.1, 2026.01-draft.
const SEMVER_LIKE = /^\d+\.\d+(?:\.\d+)?(?:-[\w.-]+)?$/;
const NAME_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

export type ValidateSaveInput = {
  policyType: string;
  name: string;
  version: string;
  visibility: string;
  definition: any;
};

export function validatePolicyForSave(input: ValidateSaveInput): PolicyValidationResult {
  const errors: PolicyValidationError[] = [];

  if (!input.policyType || typeof input.policyType !== 'string') {
    errors.push({ path: 'policyType', message: 'must be a non-empty string' });
  }

  if (!input.name || typeof input.name !== 'string') {
    errors.push({ path: 'name', message: 'must be a non-empty string' });
  } else if (!NAME_PATTERN.test(input.name)) {
    errors.push({
      path: 'name',
      message: 'must match /^[A-Z][A-Z0-9_]{1,63}$/ (uppercase identifier, e.g. USTA_JUNIOR_2026)',
    });
  }

  if (!input.version || typeof input.version !== 'string') {
    errors.push({ path: 'version', message: 'must be a non-empty string' });
  } else if (!SEMVER_LIKE.test(input.version)) {
    errors.push({ path: 'version', message: 'must be semver-shaped (e.g. 1.0.0 or 1.0.0-beta.1)' });
  }

  if (!VALID_VISIBILITIES.includes(input.visibility as PolicyVisibility)) {
    errors.push({
      path: 'visibility',
      message: `must be one of ${VALID_VISIBILITIES.join(' | ')}`,
    });
  }

  validateDefinition(input, errors);

  return errors.length ? { ok: false, errors } : { ok: true };
}

function validateDefinition(input: ValidateSaveInput, errors: PolicyValidationError[]): void {
  if (!input.definition || typeof input.definition !== 'object' || Array.isArray(input.definition)) {
    errors.push({ path: 'definition', message: 'must be a JSON object' });
    return;
  }

  if (input.policyType === 'rankingPoints') {
    validateRankingPointsDefinition(input.definition, errors);
  }
}

function validateRankingPointsDefinition(definition: any, errors: PolicyValidationError[]): void {
  const awardProfiles = definition.awardProfiles;
  if (!Array.isArray(awardProfiles) || !awardProfiles.length) {
    errors.push({
      path: 'definition.awardProfiles',
      message: 'rankingPoints policies require a non-empty awardProfiles array',
    });
    return;
  }

  awardProfiles.forEach((profile: any, idx: number) => {
    if (!profile || typeof profile !== 'object') {
      errors.push({ path: `definition.awardProfiles[${idx}]`, message: 'must be an object' });
    }
  });
}
