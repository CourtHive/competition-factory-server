import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { tournamentDetailsDto } from './dto/tournamentDetails.dto';
import { ADMIN, SUPER_ADMIN } from 'src/common/constants/roles';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/role.guard';
import { Services } from './services.service';

@UseGuards(RolesGuard)
@Controller('service')
export class ServicesController {
  constructor(private services: Services) {}

  @Post('tournamentdetails')
  @Roles([ADMIN, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  ctsRegistration(@Body() params: tournamentDetailsDto) {
    return this.services.fetchTournamentDetails(params);
  }
}
