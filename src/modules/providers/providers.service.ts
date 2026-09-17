import { buildCalendarScope } from 'src/modules/factory/helpers/checkTournamentAccess';
import { pagingFor, resolveWindow, type MyCalendarsParams } from './helpers/calendarPaging';
import { publicCalendar } from './helpers/publicCalendarEntry';
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

/**
 * No membership test — the caller's entitlement on these routes comes from elsewhere:
 * publication (`publishedOnly`) on the public route, and the controller's `@Roles` gate on
 * the operator route. Named so the two uses read as the same deliberate decision.
 */
const PUBLISHED_SCOPE = {
  unrestricted: true,
  fullAccessProviderIds: [],
  directorProviderIds: [],
  assignedTournamentIds: [],
};

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

  /**
   * UNAUTHENTICATED (`@Public()`).
   *
   * Published tournaments only, reduced to public fields. Since migration 047 the publish
   * filter and the page window run in SQL (`publishedOnly`), and `publicCalendar()` reduces
   * the FIELDS — the two are separate reductions and both still apply.
   *
   * Provider- and provisioner-facing consumers must NOT use this route — they need
   * unpublished tournaments. They use `getProviderCalendar` below.
   */
  async getCalendar({ providerAbbr, limit, offset }: MyCalendarsParams & { providerAbbr?: string }) {
    const provider = await this.findProviderByAbbr(providerAbbr);
    if (!provider) return { success: false, message: 'No calendar found' };

    const window = resolveWindow({ limit, offset });
    const { rows, total } = await this.calendarStorage.queryTournaments({
      providerIds: [provider.organisationId],
      // `publishedOnly` IS the gate on this route, so the scope must not also apply a
      // MEMBERSHIP test. `buildCalendarScope(undefined)` means "no identity, sees nothing"
      // — correct for a member-scoped read, and wrong here: it made the public calendar
      // return an empty list for every provider. Publication is the entitlement an
      // anonymous caller has; membership is not in question.
      scope: PUBLISHED_SCOPE,
      publishedOnly: true,
      ...window,
    });

    return {
      ...SUCCESS,
      calendar: publicCalendar({ provider, tournaments: rows }),
      paging: pagingFor({ total, returned: rows.length, ...window }),
    };
  }

  /**
   * AUTHENTICATED full calendar for one named provider — includes unpublished
   * tournaments and the full entry. For the AMS provider dashboard and other
   * operator surfaces. Role-gated rather than membership-scoped, because an AMS
   * admin inspects providers it is not a member of; use `getMyCalendars` for the
   * membership-scoped case.
   */
  async getProviderCalendar({ providerAbbr, limit, offset }: MyCalendarsParams & { providerAbbr?: string }) {
    if (!providerAbbr) return { error: 'providerAbbr is required' };
    const provider = await this.findProviderByAbbr(providerAbbr);
    if (!provider) return { success: false, message: 'No calendar found' };

    const window = resolveWindow({ limit, offset });
    const { rows, total } = await this.calendarStorage.queryTournaments({
      providerIds: [provider.organisationId],
      // Role-gated at the controller ([ADMIN, SUPER_ADMIN]); membership scoping would be
      // wrong here, since the point is inspecting a provider you do not belong to.
      scope: PUBLISHED_SCOPE,
      ...window,
    });

    return {
      ...SUCCESS,
      calendar: { provider, tournaments: rows },
      paging: pagingFor({ total, returned: rows.length, ...window }),
    };
  }

  /**
   * Authenticated multi-provider calendar for TMX.
   *
   * **A super-admin with no `providerAbbr` gets NOTHING** — see {@link resolveTargetProviderIds}.
   * Scoping, publish filtering and the page window all run in SQL since migration 047;
   * `scopeCalendarForUser` is no longer on this path.
   */
  async getMyCalendars(params: MyCalendarsParams, userContext: UserContext) {
    const targets = await this.resolveTargetProviderIds(params, userContext);
    const window = resolveWindow(params);
    if (!targets.length) {
      return { ...SUCCESS, calendars: [], paging: pagingFor({ total: 0, returned: 0, ...window }) };
    }

    let assignedIds = new Set<string>();
    try {
      const rows = await this.assignmentStorage.findByUserId(userContext.userId);
      assignedIds = new Set(rows.map((r) => r.tournamentId));
    } catch {
      // assignment storage may throw on LevelDB — graceful fallback
    }

    const { rows, total, totalsByProvider } = await this.calendarStorage.queryTournaments({
      providerIds: targets.map((provider) => provider.organisationId),
      scope: buildCalendarScope(userContext, assignedIds),
      ...window,
    });

    return {
      ...SUCCESS,
      calendars: this.groupByProvider(rows, targets, totalsByProvider),
      paging: pagingFor({ total, returned: rows.length, ...window }),
    };
  }

  /**
   * Which providers this call may read, as full provider records.
   *
   * The super-admin rung is **fail-closed by design** (architectural standard A3). It
   * previously returned every provider, which on 2026-09-15 served a super-admin who had
   * just stopped impersonating **49,000+ tournaments** in one response. A super-admin has no
   * membership, so "MY calendars" has no answer for one; they read any single provider by
   * naming it, which the impersonation path always does.
   */
  private async resolveTargetProviderIds(params: MyCalendarsParams, userContext: UserContext): Promise<any[]> {
    if (params.providerAbbr) {
      const provider = await this.findProviderByAbbr(params.providerAbbr);
      return provider ? [provider] : [];
    }
    if (userContext.isSuperAdmin) return [];

    const providerIds = userContext.providerIds ?? [];
    if (!providerIds.length) return [];

    const all = await this.providerStorage.getProviders();
    const wanted = new Set(providerIds);
    return (all ?? [])
      .map(({ key, value }) => ({ ...value, organisationId: value?.organisationId ?? key }))
      .filter((provider) => provider.organisationId && wanted.has(provider.organisationId));
  }

  /**
   * Regroup a flat page of rows into the per-provider response shape TMX expects.
   *
   * Every target provider stays in the response even when the window missed it entirely —
   * its `provider` block is how the client labels the row group, and dropping it would make
   * a provider vanish from the UI on page 2.
   */
  private groupByProvider(rows: any[], providers: any[], totalsByProvider: Record<string, number> = {}): any[] {
    const byProviderId = new Map<string, any[]>();
    for (const provider of providers) byProviderId.set(provider.organisationId, []);
    for (const row of rows) {
      const bucket = byProviderId.get(row.providerId);
      if (bucket) bucket.push(row);
      else byProviderId.set(row.providerId, [row]);
    }

    return providers.map((provider) => ({
      providerAbbr: provider.organisationAbbreviation,
      provider,
      tournaments: byProviderId.get(provider.organisationId) ?? [],
      // Pre-window count for THIS provider, so a truncated group is never silent.
      total: totalsByProvider[provider.organisationId] ?? 0,
    }));
  }

  /**
   * Resolve a provider by abbreviation.
   *
   * `provider_abbr` is a MUTABLE natural key — `modifyProvider` can change it — which is why
   * `calendar_tournaments` is keyed by the immutable `organisationId` and the abbreviation is
   * resolved here, at the API boundary, rather than being the tenant key.
   */
  private async findProviderByAbbr(providerAbbr?: string): Promise<any | undefined> {
    if (!providerAbbr) return undefined;
    const all = await this.providerStorage.getProviders();
    const hit = (all ?? []).find(({ value }) => value?.organisationAbbreviation === providerAbbr);
    if (!hit) return undefined;
    return { ...hit.value, organisationId: hit.value?.organisationId ?? hit.key };
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

  /** Which stored tournaments have no calendar row. Super-admin diagnostic. */
  async checkCalendars() {
    const tournamentIds = await this.tournamentStorageService.listTournamentIds();
    const listed = new Set<string>();
    for (const provider of (await this.providerStorage.getProviders()) ?? []) {
      const providerId = provider.value?.organisationId ?? provider.key;
      if (!providerId) continue;
      for (const entry of await this.calendarStorage.listProviderTournaments(providerId)) {
        listed.add(entry.tournamentId);
      }
    }
    const missingTournamentIds = tournamentIds?.filter((id) => !listed.has(id));
    return { ...SUCCESS, missingTournamentIds, tournamentsCount: tournamentIds.length };
  }

  async calendarAudit({ providerAbbr }: { providerAbbr: string }) {
    if (!providerAbbr) return { error: 'providerAbbr is required' };

    const provider = await this.findProviderByAbbr(providerAbbr);
    if (!provider) return { success: false, message: 'No calendar found' };
    const tournaments = await this.calendarStorage.listProviderTournaments(provider.organisationId);
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
