import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { UserCtx, type UserContext } from '../auth/decorators/user-context.decorator';
import { ADMIN, CLIENT, PROVIDER_ADMIN, SUPER_ADMIN } from 'src/common/constants/roles';
import { ModifyProviderDto } from './dto/modifyProvider.dto';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ProvidersService } from './providers.service';
import { TopologiesService } from './topologies.service';
import { ProviderCatalogService, assertCatalogType } from './provider-catalog.service';
import { AddProviderDto } from './dto/addProvider.dto';
import { GetProviderDto } from './dto/getProvider.dto';
import { GetCalendarDto } from './dto/getCalendar.dto';
import { RolesGuard } from '../auth/guards/role.guard';

@UseGuards(RolesGuard)
@Controller('provider')
export class ProvidersController {
  constructor(
    private readonly providers: ProvidersService,
    private readonly topologies: TopologiesService,
    private readonly catalog: ProviderCatalogService,
  ) {}

  /**
   * Per-provider topology catalog. PROVIDER_ADMIN of the target provider
   * or SUPER_ADMIN may read/write. Topology IDs are referenced by
   * `allowedDrawTypes` in `providerConfigSettings` so the Allowed
   * Selections chip widget can surface provider-defined draw structures
   * alongside the factory enum.
   */
  private assertProviderAdmin(providerId: string, ctx: UserContext): void {
    const isProviderAdmin = ctx?.providerRoles?.[providerId] === PROVIDER_ADMIN;
    if (!ctx?.isSuperAdmin && !isProviderAdmin) {
      throw new ForbiddenException('PROVIDER_ADMIN role required');
    }
  }

  @Get(':providerId/topologies')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  listTopologies(@Param('providerId') providerId: string, @UserCtx() ctx: UserContext) {
    this.assertProviderAdmin(providerId, ctx);
    return this.topologies.listForProvider(providerId);
  }

  @Get(':providerId/topologies/:topologyId')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  getTopology(
    @Param('providerId') providerId: string,
    @Param('topologyId') topologyId: string,
    @UserCtx() ctx: UserContext,
  ) {
    this.assertProviderAdmin(providerId, ctx);
    return this.topologies.getOne(providerId, topologyId);
  }

  @Post(':providerId/topologies')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  createTopology(
    @Param('providerId') providerId: string,
    @Body() body: { name: string; description?: string; state: any },
    @UserCtx() ctx: UserContext,
  ) {
    this.assertProviderAdmin(providerId, ctx);
    return this.topologies.create(providerId, body);
  }

  @Put(':providerId/topologies/:topologyId')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  updateTopology(
    @Param('providerId') providerId: string,
    @Param('topologyId') topologyId: string,
    @Body() body: { name?: string; description?: string; state?: any },
    @UserCtx() ctx: UserContext,
  ) {
    this.assertProviderAdmin(providerId, ctx);
    return this.topologies.update(providerId, topologyId, body);
  }

  @Delete(':providerId/topologies/:topologyId')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  removeTopology(
    @Param('providerId') providerId: string,
    @Param('topologyId') topologyId: string,
    @UserCtx() ctx: UserContext,
  ) {
    this.assertProviderAdmin(providerId, ctx);
    return this.topologies.remove(providerId, topologyId);
  }

  /**
   * Per-provider catalog items: compositions, tieFormats, and policies.
   * Same auth model as topologies (PROVIDER_ADMIN of target or SUPER_ADMIN).
   * `:type` is one of `composition` | `tieFormat` | `policy` — invalid
   * values 404 via the service's `assertCatalogType`.
   */
  @Get(':providerId/catalog/:type')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  listCatalog(
    @Param('providerId') providerId: string,
    @Param('type') type: string,
    @UserCtx() ctx: UserContext,
  ) {
    this.assertProviderAdmin(providerId, ctx);
    return this.catalog.list(providerId, assertCatalogType(type));
  }

  @Get(':providerId/catalog/:type/:catalogId')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  getCatalogItem(
    @Param('providerId') providerId: string,
    @Param('type') type: string,
    @Param('catalogId') catalogId: string,
    @UserCtx() ctx: UserContext,
  ) {
    this.assertProviderAdmin(providerId, ctx);
    return this.catalog.getOne(providerId, assertCatalogType(type), catalogId);
  }

  @Post(':providerId/catalog/:type')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  createCatalogItem(
    @Param('providerId') providerId: string,
    @Param('type') type: string,
    @Body() body: { name: string; description?: string; data: any; metadata?: any },
    @UserCtx() ctx: UserContext,
  ) {
    this.assertProviderAdmin(providerId, ctx);
    return this.catalog.create(providerId, assertCatalogType(type), body);
  }

  @Put(':providerId/catalog/:type/:catalogId')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  updateCatalogItem(
    @Param('providerId') providerId: string,
    @Param('type') type: string,
    @Param('catalogId') catalogId: string,
    @Body() body: { name?: string; description?: string; data?: any; metadata?: any },
    @UserCtx() ctx: UserContext,
  ) {
    this.assertProviderAdmin(providerId, ctx);
    return this.catalog.update(providerId, assertCatalogType(type), catalogId, body);
  }

  @Delete(':providerId/catalog/:type/:catalogId')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  removeCatalogItem(
    @Param('providerId') providerId: string,
    @Param('type') type: string,
    @Param('catalogId') catalogId: string,
    @UserCtx() ctx: UserContext,
  ) {
    this.assertProviderAdmin(providerId, ctx);
    return this.catalog.remove(providerId, assertCatalogType(type), catalogId);
  }

  /** Public calendar — used by courthive-public and epixodic. Unchanged. */
  @Public()
  @Post('calendar')
  @HttpCode(HttpStatus.OK)
  getCalendar(@Body() providerAbbr: GetCalendarDto) {
    return this.providers.getCalendar(providerAbbr);
  }

  /**
   * Authenticated multi-provider calendar — used by TMX.
   * Returns one filtered calendar per provider the user is associated with.
   * Optional body.providerAbbr to scope to a single provider.
   */
  @Post('my-calendars')
  @Roles([CLIENT, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  getMyCalendars(@Body() body: { providerAbbr?: string }, @UserCtx() ctx: UserContext) {
    return this.providers.getMyCalendars(body, ctx);
  }

  @Post('checkcalendars')
  @Roles([SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  checkCalendars() {
    return this.providers.checkCalendars();
  }

  @Post('calendar-audit')
  @Roles([SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  calendarAudit(@Body() body: { providerAbbr: string }) {
    return this.providers.calendarAudit(body);
  }

  @Post('allproviders')
  @Roles([SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  getProviders() {
    return this.providers.getProviders();
  }

  @Post('detail')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  getProvider(@Body() providerId: GetProviderDto) {
    return this.providers.getProvider(providerId);
  }

  @Post('add')
  @Roles([SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  addProvider(@Body() provider: AddProviderDto) {
    return this.providers.addProvider(provider);
  }

  @Post('modify')
  @Roles([ADMIN, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  modifyProvider(@Body() provider: ModifyProviderDto) {
    return this.providers.modifyProvider(provider);
  }

  /**
   * Effective provider config — the merged caps ∩ settings shape that
   * TMX consumes. Used for runtime refetch by the provider switcher
   * and for impersonation refresh. Any authenticated user with access
   * to the provider may read it; the result is identical to what TMX
   * received in their login response.
   */
  @Get(':providerId/effective-config')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  getEffectiveConfig(@Param('providerId') providerId: string, @UserCtx() ctx: UserContext) {
    if (!ctx?.isSuperAdmin && !ctx?.providerIds?.includes(providerId)) {
      throw new ForbiddenException('No access to this provider');
    }
    return this.providers.getEffectiveProviderConfig(providerId);
  }

  /**
   * Raw provider config (caps + settings, separately) — needed by the
   * provider-admin Settings editor so it can render cap-aware UI
   * (disabled fields where caps forbid, "locked by provisioner" tooltips,
   * caps-universe hints next to narrowable lists).
   *
   * PROVIDER_ADMIN of this provider OR SUPER_ADMIN. Tournament directors
   * receive only the merged effective shape via the login response and
   * never see raw caps/settings.
   */
  @Get(':providerId/raw-config')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  getRawConfig(@Param('providerId') providerId: string, @UserCtx() ctx: UserContext) {
    const isProviderAdmin = ctx?.providerRoles?.[providerId] === PROVIDER_ADMIN;
    if (!ctx?.isSuperAdmin && !isProviderAdmin) {
      throw new ForbiddenException('PROVIDER_ADMIN role required');
    }
    return this.providers.getRawProviderConfig(providerId);
  }

  /**
   * Provider-admin settings write. PROVIDER_ADMIN of the target provider
   * or SUPER_ADMIN may write. Settings must respect caps — violations
   * return per-field issues for the editor to surface inline.
   */
  @Put(':providerId/settings')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  updateSettings(
    @Param('providerId') providerId: string,
    @Body() body: { settings: Record<string, any> },
    @UserCtx() ctx: UserContext,
  ) {
    const isProviderAdmin = ctx?.providerRoles?.[providerId] === PROVIDER_ADMIN;
    if (!ctx?.isSuperAdmin && !isProviderAdmin) {
      throw new ForbiddenException('PROVIDER_ADMIN role required');
    }
    return this.providers.updateProviderSettings(providerId, body.settings ?? {});
  }
}
