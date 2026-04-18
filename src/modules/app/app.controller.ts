import { Public } from '../auth/decorators/public.decorator';
import { Controller, Get, Redirect } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  @Public()
  @Redirect('https://courthive.com', 301)
  factoryServer(): void {
    // 301 permanent redirect — courthive.net root → courthive.com
  }
}
