import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';

import { tournamentDetailsDto } from './dto/tournamentDetails.dto';
import { ADMIN, SUPER_ADMIN } from 'src/common/constants/roles';
import { Roles } from '../account/auth/decorators/roles.decorator';
import { RolesGuard } from '../account/auth/guards/role.guard';
import { FederationDataService } from './federation-data.service';

// Two endpoints, one handler:
// - `POST /service/tournamentdetails`         — legacy, kept for TMX
//   (`TMX/src/services/apis/servicesApi.ts` still calls this path).
// - `POST /service/federation-data/tournament` — new canonical alias.
//
// Both delegate to `FederationDataService.fetchTournamentDetails`.

@UseGuards(RolesGuard)
@Controller('service')
export class FederationDataController {
  constructor(private readonly service: FederationDataService) {}

  @Post('tournamentdetails')
  @Roles([ADMIN, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  legacyFetch(@Body() params: tournamentDetailsDto) {
    return this.service.fetchTournamentDetails(params);
  }

  @Post('federation-data/tournament')
  @Roles([ADMIN, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  fetch(@Body() params: tournamentDetailsDto) {
    return this.service.fetchTournamentDetails(params);
  }
}
