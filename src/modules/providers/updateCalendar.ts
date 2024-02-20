import { getCalendarEntry } from 'src/helpers/getCalendarEntry';
import netLevel from 'src/services/levelDB/netLevel';

import { BASE_CALENDAR, BASE_PROVIDER } from 'src/services/levelDB/constants';
import { SUCCESS } from 'src/common/constants/app';

export async function updateCalendar({ providerId, tournamentRecord }) {
  const provider: any = await netLevel.get(BASE_PROVIDER, { key: providerId });
  const providerAbbr = provider?.organisationAbbreviation;
  if (!providerAbbr) return { error: 'Provider not found' };

  const calendarResult: any = await netLevel.get(BASE_CALENDAR, { key: providerAbbr });
  const tournaments = calendarResult?.tournaments ?? [];

  const calendarEntry = getCalendarEntry({ tournamentRecord });
  if (calendarEntry) tournaments.push(calendarEntry);

  const updateCalendar = { provider, tournaments };
  await netLevel.set(BASE_CALENDAR, { key: providerAbbr, value: updateCalendar });

  return { ...SUCCESS };
}
