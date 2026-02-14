import { Inject, Injectable } from '@nestjs/common';
import { tools } from 'tods-competition-factory';

import { PROVIDER_STORAGE, type IProviderStorage } from 'src/storage/interfaces';
import { CALENDAR_STORAGE, type ICalendarStorage } from 'src/storage/interfaces';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { SUCCESS } from 'src/common/constants/app';

@Injectable()
export class ProvidersService {
  constructor(
    @Inject(PROVIDER_STORAGE) private readonly providerStorage: IProviderStorage,
    @Inject(CALENDAR_STORAGE) private readonly calendarStorage: ICalendarStorage,
    private readonly tournamentStorageService: TournamentStorageService,
  ) {}

  async getCalendar({ providerAbbr }) {
    const calendar = await this.calendarStorage.getCalendar(providerAbbr);
    if (!calendar) return { success: false, message: 'No calendar found' };
    return { ...SUCCESS, calendar };
  }

  async getProvider({ providerId }) {
    const provider = await this.providerStorage.getProvider(providerId);
    if (!provider) return { success: false, message: 'No provider found' };
    return { ...SUCCESS, provider };
  }

  async getProviders() {
    const providers = await this.providerStorage.getProviders();
    if (!providers) return { success: false, message: 'No providers found' };
    return { ...SUCCESS, providers };
  }

  async checkCalendars() {
    const values = await this.calendarStorage.listCalendars();
    const calendarTournamentIds = (values as Array<any>)?.flatMap((v) =>
      (v.value?.tournaments ?? []).map((t) => t.tournamentId),
    );
    const tournamentIds = await this.tournamentStorageService.listTournamentIds();
    const missingTournamentIds = tournamentIds?.filter((id) => !calendarTournamentIds?.includes(id));
    return { ...SUCCESS, missingTournamentIds, tournamentsCount: tournamentIds.length };
  }

  async addProvider(provider) {
    if (!provider?.organisationAbbreviation) return { error: 'organisationAbbreviation is required' };
    const providerResult: any = await this.getProviders();

    const providerAbbreviations = providerResult.providers.map(({ value }) => value.organisationAbbreviation);
    if (providerAbbreviations.includes(provider.organisationAbbreviation)) {
      return { error: 'organisationAbbreviation already exists' };
    }
    const providerId = tools.UUID();
    await this.providerStorage.setProvider(providerId, { ...provider, organisationId: providerId });
    return { ...SUCCESS, providerId };
  }

  async modifyProvider(provider) {
    const { providerId, organisationId, ...value } = provider;
    const key = providerId ?? organisationId;
    const storedProvider = await this.providerStorage.getProvider(key);
    if (!storedProvider) return { error: 'Provider not found' };

    await this.providerStorage.setProvider(key, { ...storedProvider, ...value });
    return { ...SUCCESS };
  }
}
