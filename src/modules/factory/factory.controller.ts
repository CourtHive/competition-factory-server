import { GetScheduledMatchUpsDto } from './dto/getCompetitionScheduleMatchUps.dto';
import { FetchTournamentUpdatedAtDto } from './dto/fetchTournamentUpdatedAt.dto';
import { RemoveTournamentRecordsDto } from './dto/removeTournamentRecords.dto';
import { FetchTournamentRecordsDto } from './dto/fetchTournamentRecords.dto';
import { QueryTournamentRecordsDto } from './dto/queryTournamentRecords.dto';
import { SaveTournamentRecordsDto } from './dto/saveTournamentRecords.dto';
import { GetScheduleProjectionDto } from './dto/getScheduleProjection.dto';
import { GetTournamentInfoDto } from './dto/getTournamentInfo.dto';
import { SetMatchUpStatusDto } from './dto/setMatchUpStatus.dto';
import { GetParticipantsDto } from './dto/getParticipants.dto';
import { ExecutionQueueDto } from './dto/executionQueue.dto';
import { GetStructureDataDto } from './dto/getStructureData.dto';
import { GetDrawDataDto } from './dto/getDrawData.dto';
import { GetEventDataDto } from './dto/getEventData.dto';
import { GetMatchUpsDto } from './dto/getMatchUps.dto';

import {
  Controller,
  Get,
  Post,
  HttpCode,
  HttpStatus,
  Body,
  UseGuards,
  Inject,
  Param,
  Logger,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { TournamentBroadcastService } from '../messaging/broadcast/tournament-broadcast.service';
import { ADMIN, CLIENT, GENERATE, PROVIDER_ADMIN, SCORE, SUPER_ADMIN } from 'src/common/constants/roles';
import { ApplyPrivacyPolicyDto } from './dto/applyPrivacyPolicy.dto';
import { Audience } from 'src/modules/account/auth/decorators/audience.decorator';
import { Public } from 'src/modules/account/auth/decorators/public.decorator';
import { Roles } from 'src/modules/account/auth/decorators/roles.decorator';
import { RolesGuard } from 'src/modules/account/auth/guards/role.guard';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { User } from '../account/auth/decorators/user.decorator';
import { UserCtx, type UserContext } from '../account/auth/decorators/user-context.decorator';
import { MutationAuthorizationService } from './mutation-authorization.service';
import { FactoryService } from './factory.service';

/**
 * Cache-key prefixes scoped to ONE entity rather than the whole tournament. These are the only keys
 * eligible to be spared when a mutation reports targeted evictions.
 *
 * Single list on purpose: a tier registered in one place and forgotten in the other is silently
 * either over-swept (loses the granularity it was added for) or under-swept (serves stale).
 */
const PER_ENTITY_PREFIXES = ['ged|', 'gdd|', 'gsd|'] as const;

@UseGuards(RolesGuard)
@Controller('factory')
export class FactoryController {
  constructor(
    private readonly factoryService: FactoryService,
    private readonly broadcastService: TournamentBroadcastService,
    private readonly mutationAuthorization: MutationAuthorizationService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  // Side-table of issued cache keys per tournamentId. cache-manager has
  // no prefix-delete primitive, so we record every key shape we hand to
  // it (gmr|<tid>, gac|<tid>, gti|<tid>, gti|<tid>|<flags>,
  // ged|<tid>|<eid>, gtm|<tid>, gtp|<tid>) and iterate-delete on write.
  // All current keys are shaped `<prefix>|<tid>[|<...>]`, so segment [1]
  // is the tournament id — see trackTournamentKey.
  //
  // Memory bound: each tournament's Set is capped via FIFO eviction so a
  // read-only public viewer that polls thousands of flag-variant
  // combinations can't grow the side-table without limit. When a key is
  // evicted from the tracking Set, the corresponding cache entry is
  // simply not iterate-evicted on the next mutation — it ages out via
  // the 3-minute cache-manager TTL instead. The cap matches the
  // expected superset of distinct keys a single tournament can produce
  // (5 fixed + 16 flag variants + up to ~150 per-event keys).
  private static readonly KEYS_PER_TOURNAMENT_CAP = 200;
  private readonly cacheKeysByTournament = new Map<string, Set<string>>();

  // Stringified-falsy values we refuse to use as tournament-id buckets.
  // Filtered post-hoc rather than at key construction because the key
  // is built across many call sites; a single chokepoint here is the
  // cheapest correct fix.
  private static readonly REJECTED_TID_LITERALS = new Set(['undefined', 'null', 'NaN', 'false', '']);

  private trackTournamentKey(key: string): void {
    const segments = key.split('|');
    const tid = segments[1];
    if (!tid || FactoryController.REJECTED_TID_LITERALS.has(tid)) return;
    let set = this.cacheKeysByTournament.get(tid);
    if (!set) {
      set = new Set<string>();
      this.cacheKeysByTournament.set(tid, set);
    }
    set.add(key);
    // FIFO eviction once we cross the cap — Set preserves insertion
    // order, so the first iterator value is the oldest entry.
    while (set.size > FactoryController.KEYS_PER_TOURNAMENT_CAP) {
      const oldest = set.values().next().value;
      if (oldest === undefined) break;
      set.delete(oldest);
    }
  }

  async cacheFx(key, fx, params) {
    if (key && typeof key === 'string') {
      const cachedData: any = await this.cacheManager.get(key);
      if (cachedData) {
        if (typeof cachedData === 'object') cachedData._cached = true;
        Logger.verbose(`Cache hit: ${key}`);
        return cachedData;
      }
    }
    const result = await fx(params);
    if (!result.error && key && typeof key === 'string') {
      this.cacheManager.set(key, result, 60 * 3 * 1000); // 3 minutes
      this.trackTournamentKey(key);
    }
    return result;
  }

  /**
   * Evict every issued per-tournament cache key after a mutation. Live
   * WebSocket clients are already notified by broadcastMutation; this
   * exists for HTTP polling clients (mobile, public viewers, automated
   * dashboards) that would otherwise eat the 3-min cache TTL after a
   * write and serve stale data for that window.
   *
   * Driven by the cacheKeysByTournament side-table so we cover every
   * variant we hand to cacheFx — including flag-variant keys
   * (gti|<tid>|<flags>) and per-event keys (ged|<tid>|<eid>) that the
   * previous fixed-prefix list missed.
   */
  private invalidateTournamentCache(
    tournamentIds: readonly string[],
    evictedEventKeys?: readonly string[],
    warmedEventKeys?: readonly string[],
    unnarrowablePrefixes?: readonly string[],
  ): void {
    // Per-event `ged|<tid>|<eid>` payloads are the bulk of this cache — measured at 3.26 MB across a
    // Grand-Slam-shaped tournament's five events, four times the tournamentRecord they derive from
    // (Mentat/tools/slam-scale-bench). Sweeping them all on every write meant one score discarded the
    // cached data for every OTHER event too. Verified with the same harness that a score leaves other
    // events' payloads byte-identical, so evicting only the affected event is sound.
    //
    // FAIL-SAFE: narrow ONLY when the mutation actually reported targeted evictions. An empty list
    // means no notice carried an eventId, so we cannot know which events changed and fall back to the
    // original tournament-wide sweep. "Invalidate less" must never silently become "serve stale".
    // Set, not Array.includes — membership check inside a per-key loop (coding-standards: Set + .has()).
    const evicted = new Set(evictedEventKeys ?? []);
    // Keys re-seeded by `warmCache` must survive: a warmed key is by definition also an evicted one,
    // so without this the sweep would delete exactly the payload the caller just paid to rebuild.
    const warmed = new Set(warmedEventKeys ?? []);
    const narrow = evicted.size > 0;
    // A tier whose handlers could not attribute a change is swept wholesale. Without this, a change
    // the handlers saw but could not target looks identical to no change at all, and the key is
    // spared — stale for the full TTL. See FactoryRequestContext.unnarrowablePrefixes.
    const unnarrowable = new Set(unnarrowablePrefixes ?? []);
    for (const tid of tournamentIds) {
      if (!tid || typeof tid !== 'string') continue;
      const keys = this.cacheKeysByTournament.get(tid);
      if (!keys) continue;
      const retained = new Set<string>();
      for (const key of keys) {
        if (warmed.has(key)) {
          retained.add(key);
          continue;
        }
        // A per-ENTITY key (event, draw, structure) is spared only when the handlers already evicted
        // the ones that changed. Tournament-scoped keys always go — they aggregate across entities.
        const prefix = PER_ENTITY_PREFIXES.find((p) => key.startsWith(p));
        const perEntity = !!prefix && !unnarrowable.has(prefix);
        if (narrow && perEntity && !evicted.has(key)) {
          retained.add(key);
          continue;
        }
        void this.cacheManager.del(key);
      }
      // Keep tracking the keys still live, so a later write can still find and evict them.
      if (retained.size) this.cacheKeysByTournament.set(tid, retained);
      else this.cacheKeysByTournament.delete(tid);
    }
  }

  @Get()
  @Public()
  default() {
    return { message: 'Factory services' };
  }

  @Public()
  @Get('version')
  getVersion(): { version: string } {
    return this.factoryService.getVersion();
  }

  // Not @Public() — the assistant context surfaces events, venues, and
  // schedule state that are not restricted to publish state. Only the
  // standard tournamentInfo reads (which respect usePublishState) are
  // intended for unauthenticated access.
  @Get('assistant-context/:tid')
  async getAssistantContext(@Param('tid') tid) {
    const key = `gac|${tid}`;
    return await this.cacheFx(key, (params) => this.factoryService.getAssistantContext(params), {
      tournamentId: tid,
    });
  }

  @Public()
  @Get('tournamentinfo/:tid')
  async getTournamentInfo(@Param('tid') tid) {
    const key = `gti|${tid}`;
    return await this.cacheFx(key, (params) => this.factoryService.getTournamentInfo(params), {
      tournamentId: tid,
      usePublishState: true,
    });
  }

  @Public()
  @Post('tournamentinfo')
  async tournamentInfo(@Body() gti: GetTournamentInfoDto) {
    const flags = [
      gti.withMatchUpStats && 'ms',
      gti.withStructureDetails && 'sd',
      gti.usePublishState && 'ps',
      gti.withVenueData && 'vd',
    ]
      .filter(Boolean)
      .join('');
    const key = `gti|${gti.tournamentId}|${flags}`;
    return await this.cacheFx(key, (params) => this.factoryService.getTournamentInfo(params), gti);
  }

  @Public()
  @Post('eventdata')
  async eventData(@Body() ged: GetEventDataDto) {
    // Key deliberately does NOT include participantsVersion. Splitting the key by version would
    // multiply entries per distinct client version AND store the participants-less variant — and a
    // cached omitted payload served to a caller holding no version blanks every bracket side to TBD.
    //
    // The cache therefore holds ONE full payload per event, and omission happens below, after the
    // read. Cache the expensive thing; make the cheap thing conditional.
    const key = `ged|${ged.tournamentId}|${ged.eventId}`;
    const result: any = await this.cacheFx(key, (params) => this.factoryService.getEventData(params), ged);

    // Participants are 52%-78.6% of this payload and identical across every event of a tournament.
    // Omit ONLY on an exact match — the caller proves what it holds rather than asserting it, so a
    // mismatch costs bytes that were not needed instead of rendering a blank draw.
    const clientHoldsCurrentSet =
      !!ged.participantsVersion &&
      !!result?.participantsVersion &&
      ged.participantsVersion === result.participantsVersion;

    if (!clientHoldsCurrentSet) return result;

    // Shallow COPY, never a mutation: this object is the cached one, shared with every other caller.
    // Deleting the key in place would poison the cache and blank the next caller's draw.
    const withoutParticipants = { ...result };
    delete withoutParticipants.participants;
    return withoutParticipants;
  }

  /**
   * Draw tier of the payload decomposition. Its OWN cache key, so a change in one draw does not evict
   * another's cached payload — cache granularity is invalidation granularity.
   *
   * `structuresProfile: 'STUBS'` is part of the key: the thin and full responses are different
   * documents and must not share an entry, or a client asking for one would receive the other.
   */
  @Public()
  @Post('drawdata')
  async drawData(@Body() gdd: GetDrawDataDto) {
    const profile = gdd.structuresProfile === 'STUBS' ? '|s' : '';
    const key = `gdd|${gdd.tournamentId}|${gdd.drawId}${profile}`;
    return await this.cacheFx(key, (params) => this.factoryService.getDrawData(params), gdd);
  }

  /**
   * Structure tier — the drill-in.
   *
   * ⚠️ This narrows the RESPONSE, not the server's work: every draw is a single structure group, so
   * the factory cannot skip assembling siblings. The justification is a per-structure cache entry and
   * a smaller body, NOT compute. See the correction in
   * `Mentat/planning/PUBLISH_WARMCACHE_AND_PAYLOAD_DECOMPOSITION.md`.
   */
  @Public()
  @Post('structuredata')
  async structureData(@Body() gsd: GetStructureDataDto) {
    const key = `gsd|${gsd.tournamentId}|${gsd.structureId}`;
    return await this.cacheFx(key, (params) => this.factoryService.getStructureData(params), gsd);
  }

  @Public()
  @Post('scheduledmatchups')
  async tournamentMatchUps(@Body() gtm: GetScheduledMatchUpsDto) {
    const key = !gtm.params?.noCache && `gtm|${gtm.params?.tournamentId}`;
    return await this.cacheFx(key, (params) => this.factoryService.getScheduleMatchUps(params), gtm);
  }

  @Public()
  @Post('participants')
  async tournamentParticipants(@Body() gtp: GetParticipantsDto) {
    const key = !gtp.params?.noCache && `gtp|${gtp.params?.tournamentId}`;
    return await this.cacheFx(key, (params) => this.factoryService.getParticipants(params), gtp);
  }

  @Post('matchups')
  @Roles([SCORE, SUPER_ADMIN])
  async getMatchUps(@Body() gmr: GetMatchUpsDto) {
    const key = `gmr|${gmr.tournamentId}`;
    return await this.cacheFx(key, (params) => this.factoryService.getMatchUps(params), gmr);
  }

  // Operational shared-facility schedule projection: slim, UNPUBLISHED ScheduleCell[] for the
  // requested tournaments the caller is authorized to view (per-tournament canViewTournament gate
  // inside the service). Not cached — the result is access-gated per user.
  @Post('schedule-projection')
  @Roles([CLIENT, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  getScheduleProjection(
    @Body() dto: GetScheduleProjectionDto,
    @User() user?: any,
    @UserCtx() userContext?: UserContext,
  ) {
    return this.factoryService.getScheduleProjection(dto, user, userContext);
  }

  @Post('score')
  // Accepts both audiences: 'admin' is the legacy TMX-user path,
  // 'score' is for service tokens minted for score-relay's persistence
  // forwarder (RELAY_SERVICE_JWT). Without the explicit @Audience the
  // AuthGuard defaults to ['admin'] and rejects score-aud tokens with
  // a generic 401, which previously misled operators following the
  // config-readiness hint to mint a SCORE-aud JWT.
  @Audience(['admin', 'score'])
  @Roles([SCORE, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  async scoreMatchUp(@Body() sms: SetMatchUpStatusDto, @Req() req: any) {
    // Stamp the authenticated identity + source onto the payload so this score
    // submission is audited and broadcast exactly like the socket and /factory
    // paths. Provisioner context is threaded when API-key / X-Provider-Id auth
    // was used. Mirrors the executionQueue() controller below — without this the
    // audit hook records a null actor (and previously never fired at all).
    const provisioner = req.provisioner
      ? { provisionerId: req.provisioner.provisionerId, providerId: req.headers?.['x-provider-id'] }
      : undefined;
    const verifiedUser = req.user;
    const enriched: any = { ...sms, provisioner, auditSource: req.auditSource, source: 'api' };
    if (verifiedUser?.email) enriched.userEmail = verifiedUser.email;
    if (verifiedUser?.userId || verifiedUser?.sub) enriched.userId = verifiedUser.userId ?? verifiedUser.sub;

    const result = await this.factoryService.score(enriched, this.cacheManager);
    if (result?.success) {
      const { publicNotices } = result;
      const tournamentId = enriched.tournamentId || enriched.params?.tournamentId;
      const payload = {
        tournamentIds: tournamentId ? [tournamentId] : [],
        methods: [{ method: 'setMatchUpStatus', params: enriched.params || sms.params || sms }],
        userId: enriched.userId,
      };
      this.broadcastService.broadcastMutation(payload);
      this.broadcastService.broadcastPublicNotices(payload, publicNotices);
      this.invalidateTournamentCache(
        payload.tournamentIds,
        result?.evictedEventKeys,
        undefined,
        result?.unnarrowablePrefixes,
      );
    }
    return result;
  }

  @Post()
  @Roles([CLIENT, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  async executionQueue(
    @Body() eqd: ExecutionQueueDto,
    @Req() req: any,
    @UserCtx() userContext?: UserContext,
  ) {
    // Thread provisioner context so executionQueue can stamp tournament ownership
    const provisioner = req.provisioner
      ? { provisionerId: req.provisioner.provisionerId, providerId: req.headers?.['x-provider-id'] }
      : undefined;
    // Stamp the JWT-verified identity onto the payload so the audit hook records
    // the authenticated user. Mirrors tmx.gateway.ts — without it, REST-path
    // mutations land in audit_log with a null user_email/user_id (the socket
    // path stamps it; this path previously did not). userId is only assigned
    // when present: audit_log.user_id is UUID-typed, so an email fallback would
    // crash the INSERT — the email belongs in userEmail.
    // Per-tournament access + provider-permission gate. The socket transport
    // applies these in TmxGateway; this route previously applied NEITHER, so a
    // CLIENT could post the same `methods` array over HTTP and bypass both.
    // Same gate, one implementation (A10).
    const requestedMethods: string[] = (eqd?.methods ?? []).map((m: any) => m?.method).filter(Boolean);
    const tournamentIds: string[] = eqd?.tournamentIds ?? (eqd?.tournamentId ? [eqd.tournamentId] : []);
    const denial = await this.mutationAuthorization.gate({
      userContext,
      tournamentIds,
      requestedMethods,
      actor: req.user?.email ?? req.user?.userId,
    });
    if (denial) throw new ForbiddenException(denial);

    const verifiedUser = req.user;
    const payload: any = { ...eqd, provisioner, auditSource: req.auditSource };
    if (verifiedUser?.email) payload.userEmail = verifiedUser.email;
    if (verifiedUser?.userId || verifiedUser?.sub) payload.userId = verifiedUser.userId ?? verifiedUser.sub;
    const result = await this.factoryService.executionQueue(payload, {
      cacheManager: this.cacheManager,
      // Lets a warmed key enter the side-table. The WS path has no side-table and passes nothing.
      trackCacheKey: (key: string) => this.trackTournamentKey(key),
    });
    if (result?.success) {
      const { publicNotices } = result;
      this.broadcastService.broadcastMutation(eqd);
      this.broadcastService.broadcastPublicNotices(eqd, publicNotices);
      this.invalidateTournamentCache(
        eqd.tournamentIds ?? [],
        result?.evictedEventKeys,
        result?.warmedEventKeys,
        result?.unnarrowablePrefixes,
      );
    }
    return result;
  }

  @Post('fetch')
  @Roles([CLIENT, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  fetchTournamentRecords(
    @Body() ftd: FetchTournamentRecordsDto,
    @User() user?: any,
    @UserCtx() userContext?: UserContext,
  ) {
    return this.factoryService.fetchTournamentRecords(ftd, user, userContext);
  }

  // Lightweight staleness probe — returns only `{ updatedAt }`, used by the TMX
  // client to detect whether it has fallen behind the server without pulling the
  // full tournament record.
  @Post('updated-at')
  @Roles([CLIENT, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  fetchTournamentUpdatedAt(
    @Body() dto: FetchTournamentUpdatedAtDto,
    @User() user?: any,
    @UserCtx() userContext?: UserContext,
  ) {
    return this.factoryService.fetchTournamentUpdatedAt(dto, user, userContext);
  }

  @Post('generate')
  @Roles([SUPER_ADMIN, GENERATE])
  @HttpCode(HttpStatus.OK)
  generateTournamentRecord(
    @Body() gtd: any,
    @User() user?: any,
    @UserCtx() userContext?: UserContext,
    @Req() req?: any,
  ) {
    // Thread provisioner context so the service can stamp the
    // tournament_provisioner ownership row + parentOrganisation
    // provisionerOrigin extension. Mirrors the executionQueue route above.
    const provisionerContext = req?.provisioner
      ? {
          provisionerId: req.provisioner.provisionerId,
          providerId: req.headers?.['x-provider-id'],
          provisionerName: req.provisioner.name,
        }
      : undefined;
    return this.factoryService.generateTournamentRecord(gtd, user, userContext, provisionerContext);
  }

  @Post('query')
  @Roles([CLIENT, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  queryTournamentRecords(@Body() qtd: QueryTournamentRecordsDto) {
    return this.factoryService.queryTournamentRecords(qtd);
  }

  @Post('remove')
  @Roles([CLIENT, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  removeTournamentRecords(
    @Body() rtd: RemoveTournamentRecordsDto,
    @User() user?: any,
    @UserCtx() userContext?: UserContext,
  ) {
    return this.factoryService.removeTournamentRecords(rtd, user, userContext);
  }

  @Post('save')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  saveTournamentRecords(
    @Body() std: SaveTournamentRecordsDto,
    @User() user?: any,
    @UserCtx() userContext?: UserContext,
  ) {
    return this.factoryService.saveTournamentRecords(std, user, userContext);
  }

  // Apply the provider's selected participant-privacy policy to its existing
  // tournaments (upcoming always; in-progress on opt-in; never completed).
  // Provider-scoped: only a PROVIDER_ADMIN of the target provider (or a
  // super-admin) may run it.
  @Post('apply-privacy-policy')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  applyPrivacyPolicy(@Body() dto: ApplyPrivacyPolicyDto, @UserCtx() ctx?: UserContext) {
    const { providerId, includeInProgress } = dto ?? ({} as ApplyPrivacyPolicyDto);
    if (!providerId) return { error: 'providerId required' };
    const isProviderAdmin = ctx?.providerRoles?.[providerId] === PROVIDER_ADMIN;
    if (!ctx?.isSuperAdmin && !isProviderAdmin) {
      throw new ForbiddenException('PROVIDER_ADMIN role required');
    }
    return this.factoryService.applyParticipantPrivacyToExisting({ providerId, includeInProgress }, ctx);
  }

  @Get('save-status/:saveId')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  getSaveStatus(@Param('saveId') saveId: string) {
    return this.factoryService.getSaveStatus(saveId);
  }

  @Post('internal/commit-save')
  @Public()
  @HttpCode(HttpStatus.OK)
  async commitSave(@Body() body: { saveId: string }, @Req() req: any) {
    const internalKey = process.env.INTERNAL_API_KEY;
    const providedKey = req.headers['x-internal-key'];
    if (!internalKey || providedKey !== internalKey) {
      return { error: 'Unauthorized' };
    }
    return this.factoryService.commitSave(body.saveId);
  }
}
