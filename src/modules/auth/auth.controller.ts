import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Request } from '@nestjs/common';
import { ADMIN, SUPER_ADMIN } from 'src/common/constants/roles';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { AuthService } from './auth.service';
import { signInDto } from './dto/signIn.dto';
import { inviteDto } from './dto/invite.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  private services = { cacheManager: this.cacheManager };

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  signIn(@Body() signIn: signInDto) {
    return this.authService.signIn(signIn.email, signIn.password);
  }

  @Post('invite')
  @Roles([ADMIN, SUPER_ADMIN])
  invite(@Body() invite: inviteDto) {
    return this.authService.invite(invite.email, invite.providerId, this.services);
  }

  /**
  @Post('register')
  @Roles([CLIENT])
  register(@Body() register: registerDto) {
    return this.authService.invite(register.invite, this.services);
  }
  */

  @Get('profile')
  getProfile(@Request() req) {
    return req.user;
  }
}
