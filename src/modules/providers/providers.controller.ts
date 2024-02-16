import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ADMIN, CLIENT, SUPER_ADMIN } from 'src/common/constants/roles';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ProvidersService } from './providers.service';
import { GetProviderDto } from './dto/getProvider.dto';
import { GetCalendarDto } from './dto/getCalendar.dto';

@Controller('provider')
export class ProvidersController {
  constructor(private providers: ProvidersService) {}

  @Public()
  @Post('calendar')
  @HttpCode(HttpStatus.OK)
  getCalendar(@Body() providerAbbr: GetCalendarDto) {
    return this.providers.getCalendar(providerAbbr);
  }

  @Post('allproviders')
  @Roles([SUPER_ADMIN])
  getProviders() {
    return this.providers.getProviders();
  }

  @Post('detail')
  @Roles([CLIENT, ADMIN])
  @HttpCode(HttpStatus.OK)
  getProvider(@Body() providerId: GetProviderDto) {
    return this.providers.getProvider(providerId);
  }
}
