// ── Global capability roles (stored in users.roles JSONB array, present in JWT) ──
// These gate endpoint access via @Roles() decorator — they answer
// "is this user allowed to call this endpoint at all?"
export const SUPER_ADMIN = 'superadmin';
export const DEVELOPER = 'developer';
export const GENERATE = 'generate';
export const CLIENT = 'client';
export const SCORE = 'score';
export const ADMIN = 'admin'; // deprecated — treated as PROVIDER_ADMIN for back-compat; will be removed

// ── Provider-scoped roles (stored in user_providers.provider_role, NOT in JWT) ──
// These answer "what can this user do within a specific provider's scope?"
// Resolved at request time via the userContext middleware, not from the JWT.
export const PROVIDER_ADMIN = 'PROVIDER_ADMIN'; // sees all tournaments in the provider
export const DIRECTOR = 'DIRECTOR';             // sees only own/assigned tournaments

// Convenience set for validation (e.g., invite role whitelist)
export const VALID_GLOBAL_ROLES = [SUPER_ADMIN, DEVELOPER, GENERATE, CLIENT, SCORE] as const;
export const VALID_PROVIDER_ROLES = [PROVIDER_ADMIN, DIRECTOR] as const;
