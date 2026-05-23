import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';

import { RolesGuard } from '../account/auth/guards/role.guard';
import { Roles } from '../account/auth/decorators/roles.decorator';
import { SUPER_ADMIN } from 'src/common/constants/roles';

import { ProviderApiKeyService } from './provider-api-key.service';

/**
 * Super-admin endpoints for managing provider-scoped API keys.
 *
 * Parallel to `admin/provisioners/:id/keys` (provisioner key CRUD) but
 * targets the `providers` table. Plaintext key is returned ONCE on POST
 * and never again.
 */
@Controller('admin/providers')
@UseGuards(RolesGuard)
@Roles([SUPER_ADMIN])
export class AdminProviderKeysController {
  constructor(private readonly providerApiKeyService: ProviderApiKeyService) {}

  @Post(':id/keys')
  @HttpCode(HttpStatus.CREATED)
  async generateKey(
    @Param('id') id: string,
    @Body() body: { label?: string },
    @Req() req: any,
  ) {
    const actor = req.user
      ? { userId: req.user.userId ?? req.user.sub, userEmail: req.user.email }
      : undefined;
    return this.providerApiKeyService.generateApiKey(id, body?.label, actor);
  }

  @Get(':id/keys')
  async listKeys(@Param('id') id: string) {
    return this.providerApiKeyService.listApiKeys(id);
  }

  @Delete(':id/keys/:keyId')
  async revokeKey(
    @Param('id') id: string,
    @Param('keyId') keyId: string,
    @Req() req: any,
  ) {
    const actor = req.user
      ? { userId: req.user.userId ?? req.user.sub, userEmail: req.user.email }
      : undefined;
    return this.providerApiKeyService.revokeApiKey(keyId, actor, id);
  }
}
