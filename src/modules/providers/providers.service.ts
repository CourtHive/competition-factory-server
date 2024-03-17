import netLevel from 'src/services/levelDB/netLevel';
import { tools } from 'tods-competition-factory';
import { Injectable } from '@nestjs/common';

import { BASE_CALENDAR, BASE_PROVIDER, BASE_TOURNAMENT } from 'src/services/levelDB/constants';
import { SUCCESS } from 'src/common/constants/app';

@Injectable()
export class ProvidersService {
  async getCalendar({ providerAbbr }) {
    const calendar = await netLevel.get(BASE_CALENDAR, { key: providerAbbr });
    if (!calendar) return { success: false, message: 'No calendar found' };
    return { ...SUCCESS, calendar };
  }

  async getProvider({ providerId }) {
    const provider = await netLevel.get(BASE_PROVIDER, { key: providerId });
    if (!provider) return { success: false, message: 'No provider found' };
    return { ...SUCCESS, provider };
  }

  async getProviders() {
    const providers = await netLevel.list(BASE_PROVIDER, { all: true });
    if (!providers) return { success: false, message: 'No providers found' };
    return { ...SUCCESS, providers };
  }

  async checkCalendars() {
    const values = await netLevel.list(BASE_CALENDAR, { all: true });
    const calendarTournamentIds = (values as Array<any>)?.flatMap((v) =>
      (v.value?.tournaments ?? []).map((t) => t.tournamentId),
    );
    const keysValues = await netLevel.keys(BASE_TOURNAMENT, { from: 0 });
    const tournamentIds = (keysValues as Array<any>)?.map((kv) => kv.key)?.filter(Boolean) ?? [];
    const missingTournamentIds = tournamentIds?.filter((id) => !calendarTournamentIds?.includes(id));
    return { ...SUCCESS, missingTournamentIds, tournamentsCount: tournamentIds.length };
  }

  async addProvider(provider) {
    if (!provider?.organisationAbbreviation) return { error: 'organisationAbbreviation is required' };
    const providerResult: any = await this.getProviders();

    const providerAbbreviations = providerResult.providers.map(
      ({ organisationAbbreviation }) => organisationAbbreviation,
    );
    if (providerAbbreviations.includes(provider.organisationAbbreviation)) {
      return { error: 'organisationAbbreviation already exists' };
    }
    const providerId = tools.UUID();
    const storageRecord = {
      value: { ...provider, organisationId: providerId },
      key: providerId,
    };
    await netLevel.set(BASE_PROVIDER, storageRecord);
    return { ...SUCCESS, providerId };
  }

  async modifyProvider(provider) {
    const { providerId, organisationId, ...value } = provider;
    const storedProvider = await netLevel.get(BASE_PROVIDER, { key: providerId ?? organisationId });
    if (!storedProvider) return { error: 'Provider not found' };

    const storageRecord = {
      value: { ...storedProvider, ...value },
      key: providerId,
    };
    await netLevel.set(BASE_PROVIDER, storageRecord);

    return { ...SUCCESS };
  }
}
