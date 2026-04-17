import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, UseGuards } from '@nestjs/common';
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
}
