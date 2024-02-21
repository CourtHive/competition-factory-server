import { SUPER_ADMIN } from 'src/common/constants/roles';

/**
 *
 * Check that user is either a SUPER_ADMIN or has a providerId
 * @param user
 * @returns boolean
 */
export function checkUser({ user }) {
  return !!(user?.roles?.includes(SUPER_ADMIN) || user?.providerIds?.length || user?.providerId);
}
