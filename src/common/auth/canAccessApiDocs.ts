import bcrypt from 'bcryptjs';

// constants and interfaces
import { SUPER_ADMIN, PROVISIONER, PROVIDER_ADMIN } from 'src/common/constants/roles';
import type {
  IUserProviderStorage,
  IUserProvisionerStorage,
  IProvisionerProviderStorage,
} from 'src/storage/interfaces';
import { buildUserContext } from 'src/modules/account/auth/helpers/buildUserContext';

export interface ApiDocsAuthDeps {
  /** Resolve a user record by email (may throw / return null when absent). */
  findUser: (email: string) => Promise<any>;
  userProviderStorage: IUserProviderStorage;
  userProvisionerStorage?: IUserProvisionerStorage;
  provisionerProviderStorage?: IProvisionerProviderStorage;
}

/**
 * Verify HTTP Basic credentials for the Swagger explorer against the shared
 * `users` table. Admits SUPER_ADMIN / PROVISIONER globally, and PROVIDER_ADMIN
 * for any provider they administer. Verify-only: it reads the users table and
 * derives roles but never signs or mints anything.
 *
 * Lives in neutral shared infra (not `account/`) so `main.ts` can gate the
 * Swagger docs without importing an account service — keeping the account tree
 * lift-out (see Mentat/planning/ACCOUNT_SERVICE_BOUNDARY.md) an import-clean
 * route flip. `AuthService.canAccessApiDocs` delegates here so the behavior has
 * a single implementation.
 */
export async function canAccessApiDocs(
  deps: ApiDocsAuthDeps,
  email: string,
  clearTextPassword: string,
): Promise<boolean> {
  if (!email || !clearTextPassword) return false;

  let user: any;
  try {
    user = await deps.findUser(email);
  } catch {
    return false;
  }
  if (!user?.password) return false;
  if (!(await bcrypt.compare(clearTextPassword, user.password))) return false;

  const roles: string[] = user.roles ?? [];
  if (roles.includes(SUPER_ADMIN) || roles.includes(PROVISIONER)) return true;

  const ctx = await buildUserContext(user, {
    userProviderStorage: deps.userProviderStorage,
    userProvisionerStorage: deps.userProvisionerStorage,
    provisionerProviderStorage: deps.provisionerProviderStorage,
  });
  return Object.values(ctx.providerRoles).includes(PROVIDER_ADMIN);
}
