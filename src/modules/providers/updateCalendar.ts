import { getCalendarEntry } from 'src/helpers/getCalendarEntry';
import netLevel from 'src/services/levelDB/netLevel';

import { BASE_CALENDAR, BASE_PROVIDER } from 'src/services/levelDB/constants';
import { SUCCESS } from 'src/common/constants/app';

export async function getProviderCalendar({ providerId }) {
  const provider: any = await netLevel.get(BASE_PROVIDER, { key: providerId });
  const providerAbbr = provider?.organisationAbbreviation;
  if (!providerAbbr) return { error: 'Provider not found' };

  const calendarResult: any = await netLevel.get(BASE_CALENDAR, { key: providerAbbr });
  const tournaments = calendarResult?.tournaments ?? [];
  return { provider, tournaments };
}

export async function updateCalendar({ provider, tournaments }) {
  const key = provider?.organisationAbbreviation;
  if (key) await netLevel.set(BASE_CALENDAR, { key, value: { provider, tournaments } });
  return { ...SUCCESS };
}

export async function addToCalendar({ providerId, tournamentRecord }) {
  const providerResult = await getProviderCalendar({ providerId });
  if (providerResult.error) return providerResult;

  const { provider, tournaments } = providerResult;

  const calendarEntry = getCalendarEntry({ tournamentRecord });
  if (calendarEntry && !tournaments.find((tournament) => tournament.tournamentId === tournamentRecord.tournamentId)) {
    tournaments.push(calendarEntry);
  }

  return await updateCalendar({ provider, tournaments });
}

export async function removeFromCalendar({ providerId, tournamentId }) {
  const providerResult = await getProviderCalendar({ providerId });
  if (providerResult.error) return providerResult;

  const { provider, tournaments } = providerResult;
  const updatedTournaments = tournaments.filter((tournament) => tournament.tournamentId !== tournamentId);
  return await updateCalendar({ provider, tournaments: updatedTournaments });
}

export async function modifyProviderCalendar({ providerId, tournamentId, updates }) {
  const providerResult = await getProviderCalendar({ providerId });
  if (providerResult.error) return providerResult;

  const existingEntry = providerResult.tournaments.find((tournament) => tournament.tournamentId === tournamentId);
  if (!existingEntry) return { error: 'Tournament not found' };

  const { provider, tournaments } = providerResult;
  const updatedEntries = tournaments.map((entry) => {
    if (entry.tournamentId === tournamentId) {
      const searchText = updates.tournamentName?.toLowerCase() || entry.searchText;
      const tournament = { ...entry.tournament, ...updates };
      return { searchText, tournamentId, providerId, tournament };
    }
    return entry;
  });

  return await updateCalendar({ provider, tournaments: updatedEntries });
}
