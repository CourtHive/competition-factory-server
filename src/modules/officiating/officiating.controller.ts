import { Controller, Post, HttpCode, HttpStatus, Body, UseGuards, Logger, ForbiddenException } from '@nestjs/common';
import { CLIENT, ADMIN, SUPER_ADMIN } from 'src/common/constants/roles';
import { Roles } from 'src/modules/auth/decorators/roles.decorator';
import { User } from 'src/modules/auth/decorators/user.decorator';
import { RolesGuard } from 'src/modules/auth/guards/role.guard';
import { OfficiatingService } from './officiating.service';
import {
  getOfficiatingScopeProviderId,
  canEvaluateOfficial,
  canManageOfficials,
  EVALUATOR_METHODS,
  MANAGER_METHODS,
  QUERY_METHODS,
} from './helpers/checkOfficiatingAccess';
import {
  ExecuteOfficiatingMethodDto,
  CreateOfficialRecordDto,
  ListOfficialRecordsDto,
  GetOfficialRecordDto,
} from './dto/officiating.dto';

@UseGuards(RolesGuard)
@Controller('officiating')
export class OfficiatingController {
  private readonly logger = new Logger(OfficiatingController.name);

  constructor(private readonly officiatingService: OfficiatingService) {}

  @Post('create')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  async create(@Body() dto: CreateOfficialRecordDto, @User() user?: any) {
    if (!canManageOfficials({ user })) throw new ForbiddenException('No provider context');

    const providerId = dto.providerId || user?.providerId;
    return this.officiatingService.createOfficialRecord({
      ...dto,
      providerId,
    });
  }

  @Post('detail')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  async detail(@Body() dto: GetOfficialRecordDto, @User() user?: any) {
    return this.officiatingService.getOfficialRecord({ ...dto, user });
  }

  @Post('list')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  async list(@Body() dto: ListOfficialRecordsDto, @User() user?: any) {
    const providerId = dto.providerId || getOfficiatingScopeProviderId({ user });
    return this.officiatingService.listOfficialRecords({ providerId });
  }

  @Post('execute')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  async execute(@Body() dto: ExecuteOfficiatingMethodDto, @User() user?: any) {
    const { method } = dto;

    const allAllowed = new Set([...EVALUATOR_METHODS, ...MANAGER_METHODS, ...QUERY_METHODS]);
    if (!allAllowed.has(method)) {
      this.logger.warn(`Unknown officiating method attempted: ${method}`);
      return { error: `Method not available: ${method}` };
    }

    const evaluatorSet = new Set(EVALUATOR_METHODS);
    if (evaluatorSet.has(method) && !canEvaluateOfficial({ user })) {
      throw new ForbiddenException(`Evaluator role required for: ${method}`);
    }

    this.logger.log(`Executing officiating method: ${method} on ${dto.officialRecordId} by ${user?.email}`);
    return this.officiatingService.executeOfficiatingMethod({ ...dto, user });
  }

  @Post('remove')
  @Roles([SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  async remove(@Body() dto: GetOfficialRecordDto) {
    return this.officiatingService.removeOfficialRecord(dto);
  }

  @Post('policies')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  async policies() {
    return this.officiatingService.getEvaluationPolicies();
  }
}
