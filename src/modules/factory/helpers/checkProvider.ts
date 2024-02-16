import { SUPER_ADMIN } from 'src/common/constants/roles';

export function checkProvider({ tournamentRecords, user }) {
  if (user.roles?.includes(SUPER_ADMIN)) return true;
  for (const record of tournamentRecords ?? {}) {
    const providerId = record?.parentOrganisation?.organisationId;
    if (providerId && !user.providerIds?.includes(providerId)) return false;
  }
  return true;
}
