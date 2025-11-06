import { SUPER_ADMIN } from 'src/common/constants/roles';

export function checkProvider({ tournamentRecords, user }) {
  if (user?.roles?.includes(SUPER_ADMIN)) return true;
  for (const tournamentId in tournamentRecords ?? {}) {
    const providerId = tournamentRecords[tournamentId]?.parentOrganisation?.organisationId;
    const providerIds = (user?.providerIds ?? user.providerId) ? [user.providerId] : [];
    if (providerId && !providerIds?.includes(providerId)) return false;
  }
  return true;
}
