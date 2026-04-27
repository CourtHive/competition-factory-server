import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { ProvisionerGuard, ProvisionerOwnerGuard } from './provisioner.guard';
import { ProvisionerService } from './provisioner.service';

/**
 * Provisioner-native endpoints. Authenticated via API key (ProvisionerMiddleware),
 * bypasses JWT auth via @Public(), then ProvisionerGuard ensures request.provisioner exists.
 */
@Controller('provisioner')
@Public()
@UseGuards(ProvisionerGuard)
export class ProvisionerController {
  constructor(private readonly provisionerService: ProvisionerService) {}

  // ── Provider directory + CRUD ──

  @Get('providers')
  async listProviders(@Req() req: any) {
    return this.provisionerService.listProviders(req.provisioner.provisionerId);
  }

  @Get('providers/:providerId')
  async getProvider(@Req() req: any, @Param('providerId') providerId: string) {
    return this.provisionerService.getProviderDetail(req.provisioner.provisionerId, providerId);
  }

  @Post('providers')
  @HttpCode(HttpStatus.CREATED)
  async createProvider(@Req() req: any, @Body() body: { organisationAbbreviation: string; organisationName: string; providerConfig?: Record<string, any> }) {
    return this.provisionerService.createProvider(req.provisioner.provisionerId, body);
  }

  @Put('providers/:providerId')
  @UseGuards(ProvisionerOwnerGuard)
  async updateProvider(
    @Param('providerId') _providerId: string,
    @Body() body: {
      providerConfig?: Record<string, any>;
      providerConfigCaps?: Record<string, any>;
      providerConfigSettings?: Record<string, any>;
      organisationName?: string;
      inactive?: boolean;
    },
    @Req() req: any,
  ) {
    const providerId = req.headers['x-provider-id'] ?? _providerId;
    return this.provisionerService.updateProviderConfig(providerId, body);
  }

  /**
   * Two-tier provider config: provisioner writes caps. Caps validator
   * rejects unknown keys + wrong types; per-field issues returned in
   * the response so the editor can surface them inline.
   */
  @Put('providers/:providerId/caps')
  @UseGuards(ProvisionerOwnerGuard)
  async updateProviderCaps(
    @Param('providerId') _providerId: string,
    @Body() body: { caps: Record<string, any> },
    @Req() req: any,
  ) {
    const providerId = req.headers['x-provider-id'] ?? _providerId;
    return this.provisionerService.updateProviderCaps(providerId, body.caps ?? {});
  }

  // ── User management ──

  @Post('users')
  @HttpCode(HttpStatus.CREATED)
  async createUser(@Req() req: any, @Body() body: {
    providerId: string;
    externalId: string;
    email: string;
    phone?: string;
    providerRole: string;
    ssoProvider: string;
  }) {
    return this.provisionerService.createSsoUser(req.provisioner.provisionerId, body);
  }

  @Get('users')
  async listUsers(@Req() req: any, @Query('providerId') providerId: string) {
    if (!providerId) return { error: 'providerId query parameter required' };
    return this.provisionerService.listProviderUsers(req.provisioner.provisionerId, providerId);
  }

  // ── Subsidiary management (owner only) ──

  @Post('providers/:providerId/subsidiaries')
  @UseGuards(ProvisionerOwnerGuard)
  @HttpCode(HttpStatus.CREATED)
  async grantSubsidiary(
    @Req() req: any,
    @Param('providerId') providerId: string,
    @Body() body: { provisionerId: string },
  ) {
    return this.provisionerService.grantSubsidiary(req.provisioner.provisionerId, providerId, body.provisionerId);
  }

  @Get('providers/:providerId/subsidiaries')
  @UseGuards(ProvisionerOwnerGuard)
  async listSubsidiaries(@Param('providerId') providerId: string) {
    return this.provisionerService.listSubsidiaries(providerId);
  }

  @Delete('providers/:providerId/subsidiaries/:provisionerId')
  @UseGuards(ProvisionerOwnerGuard)
  async revokeSubsidiary(@Param('providerId') providerId: string, @Param('provisionerId') provisionerId: string) {
    return this.provisionerService.revokeSubsidiary(providerId, provisionerId);
  }

  // ── Tournament assignments ──

  @Post('assignments/grant')
  @HttpCode(HttpStatus.OK)
  async grantAssignment(@Req() req: any, @Body() body: {
    tournamentId: string;
    userEmail: string;
    providerId: string;
    role?: string;
  }) {
    return this.provisionerService.grantAssignment(req.provisioner.provisionerId, body);
  }

  @Post('assignments/revoke')
  @HttpCode(HttpStatus.OK)
  async revokeAssignment(@Req() req: any, @Body() body: {
    tournamentId: string;
    userEmail: string;
    providerId: string;
  }) {
    return this.provisionerService.revokeAssignment(req.provisioner.provisionerId, body);
  }

  @Post('assignments/list')
  @HttpCode(HttpStatus.OK)
  async listAssignments(@Req() req: any, @Body() body: { tournamentId?: string; providerId: string }) {
    return this.provisionerService.listAssignments(req.provisioner.provisionerId, body);
  }
}
