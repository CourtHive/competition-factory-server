// Layout
export const EMPTY_STRING = '';
export const FLEX = 'flex';
export const NONE = 'none';
export const CENTER = 'center';
export const LEFT = 'left';
export const RIGHT = 'right';

// DOM IDs — page containers
export const TMX_ADMIN = 'tmxAdmin';
export const TMX_SYSTEM = 'tmxSystem';
export const TMX_PROVISIONER = 'tmxProvisioner';
export const TMX_DRAWER = 'tmxDrawer';

// Roles
export const SUPER_ADMIN = 'superadmin';
export const ADMIN = 'admin';
export const PROVISIONER = 'provisioner';
// Provider-scoped role (from user_providers.provider_role, in the JWT's
// providerAssociations). Distinct from the deprecated global `admin` role.
export const PROVIDER_ADMIN = 'PROVIDER_ADMIN';

// Routes
export const NO_ACCESS_ROUTE = 'no-access';

// System page tabs
export const SYSTEM = 'system';
export const PROVIDERS_TAB = 'providers';
export const USERS_TAB = 'users';
export const PROVISIONERS_TAB = 'provisioners';
export const ROOMS_TAB = 'rooms';
export const AUDIT_TAB = 'audit';

// Provisioner workspace (Phase 2A.5)
export const PROVISIONER_ROUTE = 'provisioner';

// Sanctioning
export const TMX_SANCTIONING = 'tmxSanctioning';
export const SANCTIONING = 'sanctioning';

// Templates (per-provider topology / tieFormat / composition catalogs)
export const TMX_TEMPLATES = 'tmxTemplates';
export const TEMPLATES = 'templates';

// Policies (per-provider policy catalog)
export const TMX_POLICIES = 'tmxPolicies';
export const POLICIES = 'policies';

// Tournament Sync
export const TMX_SYNC = 'tmxSync';
export const SYNC = 'sync';

// Verify email (public landing for email-verification link)
export const TMX_VERIFY_EMAIL = 'tmxVerifyEmail';
export const VERIFY_EMAIL = 'verify-email';

// Reset password (public landing for password-reset link)
export const TMX_RESET_PASSWORD = 'tmxResetPassword';
export const RESET_PASSWORD = 'reset-password';

// Navigation targets
export const TOURNAMENT_SETTINGS = 'tournamentSettings';
export const TMX_TOURNAMENTS = 'tournaments';
