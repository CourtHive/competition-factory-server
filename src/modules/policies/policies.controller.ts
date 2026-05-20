import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/role.guard';
import { Public } from '../auth/decorators/public.decorator';
import { UserCtx, type UserContext } from '../auth/decorators/user-context.decorator';
import { CLIENT, ADMIN, SUPER_ADMIN } from 'src/common/constants/roles';
import { PoliciesService } from './policies.service';
import { SavePolicyDto } from './dto/save-policy.dto';

@Controller('policies')
export class PoliciesController {
  constructor(private readonly service: PoliciesService) {}

  // Public — explicit @Public() opts out of the global AuthGuard. Returns
  // SHARED_DEMO + TEMPLATE_REF policies.
  @Public()
  @Get('catalog')
  catalog(@Query('policyType') policyType?: string) {
    return this.service.listPublicCatalog({ policyType });
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  listForUser(@UserCtx() ctx: UserContext, @Query('policyType') policyType?: string) {
    return this.service.listForUser(ctx, { policyType });
  }

  @Get(':policyType/:name')
  @UseGuards(RolesGuard)
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  getOne(
    @Param('policyType') policyType: string,
    @Param('name') name: string,
    @Query('version') version: string | undefined,
    @UserCtx() ctx: UserContext,
  ) {
    return this.service.getOne({ policyType, name, version }, ctx);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  save(@Body() body: SavePolicyDto, @UserCtx() ctx: UserContext) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Request body must be a SavePolicyDto');
    }
    return this.service.save(body, ctx);
  }

  @Delete(':policyId')
  @UseGuards(RolesGuard)
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  remove(@Param('policyId') policyId: string, @UserCtx() ctx: UserContext) {
    return this.service.deleteByPolicyId(policyId, ctx);
  }
}
