import { SUPER_ADMIN } from 'src/common/constants/roles';

export function checkProvider({ tournamentRecords, user }) {
  if (user?.roles?.includes(SUPER_ADMIN)) return true;

  const providerIds = user?.providerIds?.length ? user.providerIds : user?.providerId ? [user.providerId] : [];

  for (const tournamentId in tournamentRecords ?? {}) {
    const providerId = tournamentRecords[tournamentId]?.parentOrganisation?.organisationId;
    if (providerId && !providerIds.includes(providerId)) return false;
  }
  return true;
}
