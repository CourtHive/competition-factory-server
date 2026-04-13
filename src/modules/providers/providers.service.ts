import { Inject, Injectable } from '@nestjs/common';
import { tools } from 'tods-competition-factory';

import { PROVIDER_STORAGE, type IProviderStorage, ASSIGNMENT_STORAGE, type IAssignmentStorage } from 'src/storage/interfaces';
import { CALENDAR_STORAGE, type ICalendarStorage } from 'src/storage/interfaces';
import { scopeCalendarForUser } from 'src/modules/factory/helpers/checkTournamentAccess';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import type { UserContext } from 'src/modules/auth/decorators/user-context.decorator';
import { SUCCESS } from 'src/common/constants/app';

@Injectable()
export class ProvidersService {
  constructor(
    @Inject(PROVIDER_STORAGE) private readonly providerStorage: IProviderStorage,
    @Inject(CALENDAR_STORAGE) private readonly calendarStorage: ICalendarStorage,
    @Inject(ASSIGNMENT_STORAGE) private readonly assignmentStorage: IAssignmentStorage,
    private readonly tournamentStorageService: TournamentStorageService,
  ) {}

  async getCalendar({ providerAbbr }) {
    const calendar = await this.calendarStorage.getCalendar(providerAbbr);
    if (!calendar) return { success: false, message: 'No calendar found' };
    return { ...SUCCESS, calendar };
  }

  /**
   * Authenticated multi-provider calendar for TMX.
   *
   * For each provider the user is associated with (via user_providers),
   * fetches that provider's calendar and filters it through the access-
   * control helper. Returns an array of per-provider calendars so TMX
   * can render a unified multi-provider tournaments table.
   */
  async getMyCalendars(params: { providerAbbr?: string }, userContext: UserContext) {
    // Resolve the user's assigned tournament IDs (for DIRECTOR scoping)
    let assignedIds = new Set<string>();
    try {
      const rows = await this.assignmentStorage.findByUserId(userContext.userId);
      assignedIds = new Set(rows.map((r) => r.tournamentId));
    } catch {
      // assignment storage may throw on LevelDB — graceful fallback
    }

    // Determine which provider abbreviations to fetch
    const allProviders = await this.providerStorage.getProviders();
    const providerAbbrMap: Record<string, string> = {}; // providerId → providerAbbr
    for (const { key, value } of allProviders ?? []) {
      const pid = key || value?.organisationId;
      const abbr = value?.organisationAbbreviation;
      if (pid && abbr) providerAbbrMap[pid] = abbr;
    }

    // For super-admin with a specific providerAbbr filter, scope to that
    const targetAbbrs: string[] = [];
    if (params.providerAbbr) {
      targetAbbrs.push(params.providerAbbr);
    } else if (userContext.isSuperAdmin) {
      // Super admin with no filter: return all provider calendars
      targetAbbrs.push(...Object.values(providerAbbrMap));
    } else {
      for (const pid of userContext.providerIds) {
        const abbr = providerAbbrMap[pid];
        if (abbr) targetAbbrs.push(abbr);
      }
    }

    // Fetch + scope each calendar
    const calendars: any[] = [];
    for (const abbr of targetAbbrs) {
      const calendar = await this.calendarStorage.getCalendar(abbr);
      if (!calendar) continue;

      const filtered = scopeCalendarForUser(calendar.tournaments ?? [], userContext, assignedIds);
      calendars.push({
        providerAbbr: abbr,
        provider: calendar.provider,
        tournaments: filtered,
      });
    }

    return { ...SUCCESS, calendars };
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
