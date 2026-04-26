/**
 * DOM selectors for admin-client e2e tests.
 *
 * Mirrors the TMX e2e/helpers/selectors.ts pattern. Uses the same
 * tmxConstants IDs the production code uses so tests don't drift from
 * implementation details.
 */
const id = (name: string) => `#${name}`;

export const S = {
  // Page containers
  TMX_SYSTEM: id('tmxSystem'),
  TMX_ADMIN: id('tmxAdmin'),
  TMX_PROVISIONER: id('tmxProvisioner'),
  TMX_SANCTIONING: id('tmxSanctioning'),
  TMX_SYNC: id('tmxSync'),

  // Navbar icons
  H_SYSTEM: id('h-system'),
  H_ADMIN: id('h-admin'),
  H_PROVISIONER: id('h-provisioner'),
  H_SANCTIONING: id('h-sanctioning'),
  H_SYNC: id('h-sync'),
  H_STOP_IMPERSONATING: id('h-stop-impersonating'),
  LOGIN: id('login'),
  THEME_TOGGLE: id('themeToggle'),

  // System provisioners panel — table IDs
  PROVISIONERS_LIST_TABLE: id('systemProvisionerListTable'),
  PROVISIONERS_KEYS_TABLE: id('systemProvisionerKeysTable'),
  PROVISIONERS_ASSOC_TABLE: id('systemProvisionerAssocTable'),
  PROVISIONERS_REPS_TABLE: id('systemProvisionerRepsTable'),

  // Provisioner workspace — table IDs
  PROVISIONER_PROVIDERS_TABLE: id('provisionerProvidersTable'),
  PROVISIONER_USERS_TABLE: id('provisionerUsersTable'),
};
