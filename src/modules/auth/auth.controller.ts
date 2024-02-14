import { Body, Controller, Get, HttpCode, HttpStatus, Post, Request } from '@nestjs/common';
import { Public } from './decorators/public.decorator';
import { AuthService } from './auth.service';
import { signInDto } from './dto/signIn.dto';
// import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { Roles } from './decorators/roles.decorator';
import { ADMIN, SUPER_ADMIN } from 'src/common/constants/roles';
import { inviteDto } from './dto/invite.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    // @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  signIn(@Body() signIn: signInDto) {
    return this.authService.signIn(signIn.email, signIn.password);
  }

  @Post('invite')
  @Roles([ADMIN, SUPER_ADMIN])
  invite(@Body() invite: inviteDto) {
    // !!this.cacheManager;
    return this.authService.invite(invite.email, invite.providerId);
  }

  @Get('profile')
  getProfile(@Request() req) {
    return req.user;
  }
}
