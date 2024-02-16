import { Public } from '../auth/decorators/public.decorator';
import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @Public()
  factoryServer(): any {
    return this.appService.factoryServer();
  }
}
