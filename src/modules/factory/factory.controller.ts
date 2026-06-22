import { GetScheduledMatchUpsDto } from './dto/getCompetitionScheduleMatchUps.dto';
import { FetchTournamentUpdatedAtDto } from './dto/fetchTournamentUpdatedAt.dto';
import { RemoveTournamentRecordsDto } from './dto/removeTournamentRecords.dto';
import { FetchTournamentRecordsDto } from './dto/fetchTournamentRecords.dto';
import { QueryTournamentRecordsDto } from './dto/queryTournamentRecords.dto';
import { SaveTournamentRecordsDto } from './dto/saveTournamentRecords.dto';
import { GetTournamentInfoDto } from './dto/getTournamentInfo.dto';
import { SetMatchUpStatusDto } from './dto/setMatchUpStatus.dto';
import { GetParticipantsDto } from './dto/getParticipants.dto';
import { ExecutionQueueDto } from './dto/executionQueue.dto';
import { GetEventDataDto } from './dto/getEventData.dto';
import { GetMatchUpsDto } from './dto/getMatchUps.dto';

import { Controller, Get, Post, HttpCode, HttpStatus, Body, UseGuards, Inject, Param, Logger, Req } from '@nestjs/common';
import { TournamentBroadcastService } from '../messaging/broadcast/tournament-broadcast.service';
import { ADMIN, CLIENT, GENERATE, SCORE, SUPER_ADMIN } from 'src/common/constants/roles';
import { Audience } from 'src/modules/account/auth/decorators/audience.decorator';
import { Public } from 'src/modules/account/auth/decorators/public.decorator';
import { Roles } from 'src/modules/account/auth/decorators/roles.decorator';
import { RolesGuard } from 'src/modules/account/auth/guards/role.guard';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { User } from '../account/auth/decorators/user.decorator';
import { UserCtx, type UserContext } from '../account/auth/decorators/user-context.decorator';
import { FactoryService } from './factory.service';

@UseGuards(RolesGuard)
@Controller('factory')
export class FactoryController {
  constructor(
    private readonly factoryService: FactoryService,
    private readonly broadcastService: TournamentBroadcastService,
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
  private invalidateTournamentCache(tournamentIds: readonly string[]): void {
    for (const tid of tournamentIds) {
      if (!tid || typeof tid !== 'string') continue;
      const keys = this.cacheKeysByTournament.get(tid);
      if (!keys) continue;
      for (const key of keys) {
        void this.cacheManager.del(key);
      }
      this.cacheKeysByTournament.delete(tid);
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
    const key = `ged|${ged.tournamentId}|${ged.eventId}`;
    return await this.cacheFx(key, (params) => this.factoryService.getEventData(params), ged);
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
  async scoreMatchUp(@Body() sms: SetMatchUpStatusDto) {
    const result = await this.factoryService.score(sms, this.cacheManager);
    if (result?.success) {
      const { publicNotices } = result;
      const tournamentId = sms.tournamentId || sms.params?.tournamentId;
      const payload = {
        tournamentIds: tournamentId ? [tournamentId] : [],
        methods: [{ method: 'setMatchUpStatus', params: sms.params || sms }],
      };
      this.broadcastService.broadcastMutation(payload);
      this.broadcastService.broadcastPublicNotices(payload, publicNotices);
      this.invalidateTournamentCache(payload.tournamentIds);
    }
    return result;
  }

  @Post()
  @Roles([CLIENT, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  async executionQueue(@Body() eqd: ExecutionQueueDto, @Req() req: any) {
    // Thread provisioner context so executionQueue can stamp tournament ownership
    const provisioner = req.provisioner
      ? { provisionerId: req.provisioner.provisionerId, providerId: req.headers?.['x-provider-id'] }
      : undefined;
    const result = await this.factoryService.executionQueue(
      { ...eqd, provisioner, auditSource: req.auditSource },
      { cacheManager: this.cacheManager },
    );
    if (result?.success) {
      const { publicNotices } = result;
      this.broadcastService.broadcastMutation(eqd);
      this.broadcastService.broadcastPublicNotices(eqd, publicNotices);
      this.invalidateTournamentCache(eqd.tournamentIds ?? []);
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
