import { Controller, Get, Post, HttpCode, HttpStatus, Body, UseGuards } from '@nestjs/common';
import { ConvertTournamentDto } from './dto/convertTournament.dto';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/role.guard';
import { ConversionService } from './conversion.service';

@UseGuards(RolesGuard)
@Controller('conversion')
export class ConversionController {
  constructor(private readonly conversionService: ConversionService) {}

  @Get()
  @Public()
  default() {
    return { message: 'Conversion services' };
  }

  @Post('convert')
  @Roles(['client'])
  @HttpCode(HttpStatus.OK)
  convertTournament(@Body() ctd: ConvertTournamentDto) {
    return this.conversionService.convertTournament(ctd);
  }
}
