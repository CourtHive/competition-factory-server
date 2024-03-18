import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ADMIN, CLIENT, SUPER_ADMIN } from 'src/common/constants/roles';
import { ModifyProviderDto } from './dto/modifyProvider.dto';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ProvidersService } from './providers.service';
import { AddProviderDto } from './dto/addProvider.dto';
import { GetProviderDto } from './dto/getProvider.dto';
import { GetCalendarDto } from './dto/getCalendar.dto';
import { RolesGuard } from '../auth/guards/role.guard';

@UseGuards(RolesGuard)
@Controller('provider')
export class ProvidersController {
  constructor(private providers: ProvidersService) {}

  @Public()
  @Post('calendar')
  @HttpCode(HttpStatus.OK)
  getCalendar(@Body() providerAbbr: GetCalendarDto) {
    return this.providers.getCalendar(providerAbbr);
  }

  @Post('checkcalendars')
  @Roles([SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  checkCalendars() {
    return this.providers.checkCalendars();
  }

  @Post('allproviders')
  @Roles([SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  getProviders() {
    return this.providers.getProviders();
  }

  @Post('detail')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  getProvider(@Body() providerId: GetProviderDto) {
    return this.providers.getProvider(providerId);
  }

  @Post('add')
  @Roles([SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  addProvider(@Body() provider: AddProviderDto) {
    return this.providers.addProvider(provider);
  }

  @Post('modify')
  @Roles([ADMIN, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  modifyProvider(@Body() provider: ModifyProviderDto) {
    return this.providers.modifyProvider(provider);
  }
}
