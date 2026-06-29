import { scopeCalendarForUser } from 'src/modules/factory/helpers/checkTournamentAccess';
import type { UserContext } from 'src/modules/account/auth/decorators/user-context.decorator';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { computeEffectiveConfig, DEFAULT_SCORING_LAUNCH, validateSettings } from '@courthive/provider-config';
import { Inject, Injectable } from '@nestjs/common';
import { tools } from 'tods-competition-factory';

// constants and interfaces
import { SUCCESS } from 'src/common/constants/app';
import {
  CALENDAR_STORAGE,
  PROVIDER_STORAGE,
  type IProviderStorage,
  ASSIGNMENT_STORAGE,
  type IAssignmentStorage,
  type ICalendarStorage,
  TOURNAMENT_PROVISIONER_STORAGE,
  type ITournamentProvisionerStorage,
} from 'src/storage/interfaces';

@Injectable()
export class ProvidersService {
  constructor(
    @Inject(PROVIDER_STORAGE) private readonly providerStorage: IProviderStorage,
    @Inject(CALENDAR_STORAGE) private readonly calendarStorage: ICalendarStorage,
    @Inject(ASSIGNMENT_STORAGE) private readonly assignmentStorage: IAssignmentStorage,
    @Inject(TOURNAMENT_PROVISIONER_STORAGE)
    private readonly tournamentProvisionerStorage: ITournamentProvisionerStorage,
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

  async calendarAudit({ providerAbbr }: { providerAbbr: string }) {
    if (!providerAbbr) return { error: 'providerAbbr is required' };

    const calendar = await this.calendarStorage.getCalendar(providerAbbr);
    const tournaments = calendar?.tournaments ?? [];
    const tournamentIds = await this.tournamentStorageService.listTournamentIds();
    const storageIdSet = new Set(tournamentIds);

    const calendarEntries = tournaments.map((entry) => ({
      ...entry,
      existsInStorage: storageIdSet.has(entry.tournamentId),
    }));

    const total = calendarEntries.length;
    const existing = calendarEntries.filter((e) => e.existsInStorage).length;

    return { ...SUCCESS, calendarEntries, counts: { total, existing, missing: total - existing } };
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

  /**
   * Raw provider config — both tiers separately. Used by the
   * provider-admin Settings editor for cap-aware UI rendering.
   * Tournament directors should NOT see this shape — they receive
   * only the merged effective config via login.
   */
  async getRawProviderConfig(providerId: string) {
    const provider = await this.providerStorage.getProvider(providerId);
    if (!provider) return { error: 'Provider not found' };
    return {
      ...SUCCESS,
      providerId,
      caps: provider.providerConfigCaps ?? {},
      settings: provider.providerConfigSettings ?? {},
    };
  }

  /**
   * Effective provider config — caps ∩ settings, computed via the
   * shared merge function. Returned shape matches TMX's
   * `ProviderConfigData` (the consumer-facing flat shape).
   */
  async getEffectiveProviderConfig(providerId: string) {
    const provider = await this.providerStorage.getProvider(providerId);
    if (!provider) return { error: 'Provider not found' };
    const effective = computeEffectiveConfig(
      provider.providerConfigCaps,
      provider.providerConfigSettings,
    );
    return { ...SUCCESS, providerId, effective };
  }

  /**
   * Public-safe branding lookup keyed by tournamentId — used by
   * unauthenticated viewers (courthive-public) so the page can theme
   * itself to the owning provider. Returns ONLY the branding slice
   * (logos, themeTokens, stylesheetUrl, accentColor, appName); all
   * other config (permissions, policies, integrations) stays private.
   *
   * Returns `{ branding: undefined }` when the tournament has no
   * provider mapping or the provider was deleted — the viewer
   * gracefully falls back to bundled defaults.
   */
  async getPublicBrandingByTournament(tournamentId: string) {
    const tp = await this.tournamentProvisionerStorage.getByTournament(tournamentId);
    if (!tp?.providerId) return { ...SUCCESS, branding: undefined };
    const provider = await this.providerStorage.getProvider(tp.providerId);
    if (!provider) return { ...SUCCESS, branding: undefined };
    const effective = computeEffectiveConfig(provider.providerConfigCaps, provider.providerConfigSettings);
    return { ...SUCCESS, branding: effective.branding };
  }

  /**
   * Public-safe scoring-launch lookup keyed by tournamentId — used by
   * unauthenticated viewers (courthive-public) to resolve which scoring
   * app a per-matchUp "Score this match" action launches. Returns ONLY
   * the `integrations.scoringLaunch` slice; all other config stays
   * private (mirrors `getPublicBrandingByTournament`).
   *
   * Falls back to `DEFAULT_SCORING_LAUNCH` (EPIXODIC) when the tournament
   * has no provider mapping, the provider was deleted, or the provider
   * declared no scoringLaunch — so the viewer always has a launch target.
   */
  async getPublicScoringLaunchByTournament(tournamentId: string) {
    const tp = await this.tournamentProvisionerStorage.getByTournament(tournamentId);
    if (!tp?.providerId) return { ...SUCCESS, scoringLaunch: DEFAULT_SCORING_LAUNCH };
    const provider = await this.providerStorage.getProvider(tp.providerId);
    if (!provider) return { ...SUCCESS, scoringLaunch: DEFAULT_SCORING_LAUNCH };
    const effective = computeEffectiveConfig(provider.providerConfigCaps, provider.providerConfigSettings);
    return { ...SUCCESS, scoringLaunch: effective.integrations?.scoringLaunch ?? DEFAULT_SCORING_LAUNCH };
  }

  /**
   * Settings write with cap-respect validation. Per-field issues
   * returned in the response when settings exceed caps.
   */
  async updateProviderSettings(providerId: string, settings: Record<string, any>) {
    const provider = await this.providerStorage.getProvider(providerId);
    if (!provider) return { error: 'Provider not found' };
    const issues = validateSettings(settings, provider.providerConfigCaps ?? {});
    if (issues.length) return { error: 'settings validation failed', code: 'SETTINGS_INVALID', issues };
    return this.providerStorage.updateProviderSettings(providerId, settings);
  }
}
