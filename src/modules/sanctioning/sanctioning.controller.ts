import { Controller, Post, HttpCode, HttpStatus, Body, UseGuards, Logger, ForbiddenException } from '@nestjs/common';
import { Roles } from 'src/modules/auth/decorators/roles.decorator';
import { User } from 'src/modules/auth/decorators/user.decorator';
import { RolesGuard } from 'src/modules/auth/guards/role.guard';
import { CLIENT, ADMIN, SUPER_ADMIN } from 'src/common/constants/roles';
import { SanctioningService } from './sanctioning.service';
import {
  canApplySanctioning,
  canReviewSanctioning,
  getSanctioningScopeProviderId,
  REVIEWER_METHODS,
  APPLICANT_METHODS,
  QUERY_METHODS,
} from './helpers/checkSanctioningAccess';

import {
  CreateSanctioningRecordDto,
  GetSanctioningRecordDto,
  ListSanctioningRecordsDto,
  ExecuteSanctioningMethodDto,
  CheckCalendarConflictsDto,
} from './dto/sanctioning.dto';

@UseGuards(RolesGuard)
@Controller('sanctioning')
export class SanctioningController {
  private readonly logger = new Logger(SanctioningController.name);

  constructor(private readonly sanctioningService: SanctioningService) {}

  /**
   * Create a new sanctioning application.
   * CLIENT, ADMIN, and SUPER_ADMIN can create.
   * The applicantProviderId is auto-set from the user's provider.
   */
  @Post('create')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  async create(@Body() dto: CreateSanctioningRecordDto, @User() user?: any) {
    if (!canApplySanctioning({ user })) throw new ForbiddenException('No provider context');

    // Auto-inject the user's providerId as the applicant provider
    const applicantProviderId = dto.applicantProviderId || user?.providerId;
    return this.sanctioningService.createSanctioningRecord({
      ...dto,
      applicantProviderId,
    });
  }

  /**
   * Get a single sanctioning record.
   * Access controlled: user must own the record or be ADMIN/SUPER_ADMIN.
   */
  @Post('detail')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  async detail(@Body() dto: GetSanctioningRecordDto, @User() user?: any) {
    return this.sanctioningService.getSanctioningRecord({ ...dto, user });
  }

  /**
   * List sanctioning records.
   * Scoped to user's provider. SUPER_ADMIN sees all.
   */
  @Post('list')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  async list(@Body() dto: ListSanctioningRecordsDto, @User() user?: any) {
    const providerId = dto.providerId || getSanctioningScopeProviderId({ user });
    return this.sanctioningService.listSanctioningRecords({ providerId });
  }

  /**
   * Execute a sanctioning engine method on a record.
   * Role enforcement: reviewer methods require ADMIN/SUPER_ADMIN.
   * Applicant methods require ownership (matching provider).
   */
  @Post('execute')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  async execute(@Body() dto: ExecuteSanctioningMethodDto, @User() user?: any) {
    const { method } = dto;

    // Check method is allowed
    const allAllowed = [...REVIEWER_METHODS, ...APPLICANT_METHODS, ...QUERY_METHODS];
    if (!allAllowed.includes(method)) {
      this.logger.warn(`Unknown sanctioning method attempted: ${method}`);
      return { error: `Method not available: ${method}` };
    }

    // Reviewer methods require ADMIN or SUPER_ADMIN
    if (REVIEWER_METHODS.includes(method) && !canReviewSanctioning({ user })) {
      throw new ForbiddenException(`Reviewer role required for: ${method}`);
    }

    this.logger.log(`Executing sanctioning method: ${method} on ${dto.sanctioningId} by ${user?.email}`);
    return this.sanctioningService.executeSanctioningMethod({ ...dto, user });
  }

  /**
   * Remove a sanctioning record. SUPER_ADMIN only.
   */
  @Post('remove')
  @Roles([SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  async remove(@Body() dto: GetSanctioningRecordDto) {
    return this.sanctioningService.removeSanctioningRecord(dto);
  }

  /**
   * List available sanctioning policies.
   */
  @Post('policies')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  async policies() {
    return this.sanctioningService.getSanctioningPolicies();
  }

  /**
   * Check calendar conflicts for a sanctioning record.
   */
  @Post('calendar-check')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  async calendarCheck(@Body() dto: CheckCalendarConflictsDto, @User() user?: any) {
    return this.sanctioningService.checkCalendarConflicts({ ...dto, user });
  }
}
