import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { RolesGuard } from '../auth/guards/role.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SUPER_ADMIN } from 'src/common/constants/roles';
import { ProvisionerService } from './provisioner.service';

@Controller('admin/provisioners')
@UseGuards(RolesGuard)
@Roles([SUPER_ADMIN])
export class AdminProvisionerController {
  constructor(private readonly provisionerService: ProvisionerService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: { name: string; config?: Record<string, any> }) {
    return this.provisionerService.createProvisioner(body);
  }

  @Get()
  async list() {
    return this.provisionerService.listProvisioners();
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.provisionerService.getProvisioner(id);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: { name?: string; isActive?: boolean; config?: Record<string, any> }) {
    return this.provisionerService.updateProvisioner(id, body);
  }

  /**
   * Hard-delete a provisioner with cascade. Refuses to delete unless the
   * provisioner is already deactivated (two-step safeguard enforced
   * server-side, not just in the UI).
   */
  @Delete(':id')
  async delete(@Param('id') id: string, @Req() req: any) {
    const actor = req.user
      ? { userId: req.user.userId ?? req.user.sub, userEmail: req.user.email }
      : undefined;
    return this.provisionerService.deleteProvisioner(id, actor);
  }

  // ── API Key management ──

  @Post(':id/keys')
  @HttpCode(HttpStatus.CREATED)
  async generateKey(@Param('id') id: string, @Body() body: { label?: string }) {
    return this.provisionerService.generateApiKey(id, body.label);
  }

  @Get(':id/keys')
  async listKeys(@Param('id') id: string) {
    return this.provisionerService.listApiKeys(id);
  }

  @Delete(':id/keys/:keyId')
  async revokeKey(@Param('keyId') keyId: string) {
    return this.provisionerService.revokeApiKey(keyId);
  }

  // ── Provider association ──

  @Get(':id/providers')
  async listProvisionerProviders(@Param('id') id: string) {
    const result = await this.provisionerService.listProviders(id);
    return { success: true, providers: (result.providers ?? []).filter((p: any) => p.managed) };
  }

  @Post(':id/providers')
  @HttpCode(HttpStatus.CREATED)
  async associateProvider(
    @Param('id') id: string,
    @Body() body: { providerId: string; relationship: 'owner' | 'subsidiary' },
  ) {
    return this.provisionerService.associateProvider(id, body.providerId, body.relationship);
  }

  @Delete(':id/providers/:providerId')
  async disassociateProvider(@Param('id') id: string, @Param('providerId') providerId: string) {
    return this.provisionerService.disassociateProvider(id, providerId);
  }

  // ── User-as-provisioner-representative (Phase 2A) ──

  @Get(':id/users')
  async listRepresentatives(@Param('id') id: string) {
    return this.provisionerService.listProvisionerRepresentatives(id);
  }

  @Post(':id/users')
  @HttpCode(HttpStatus.CREATED)
  async assignUser(
    @Param('id') id: string,
    @Body() body: { email: string },
    @Req() req: any,
  ) {
    const grantedBy = req.user?.userId ?? req.user?.sub;
    return this.provisionerService.assignUserToProvisioner(id, body.email, grantedBy);
  }

  @Delete(':id/users/:userId')
  async removeUser(@Param('id') id: string, @Param('userId') userId: string) {
    return this.provisionerService.removeUserFromProvisioner(id, userId);
  }
}
