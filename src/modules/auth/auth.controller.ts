import { Body, Controller, Get, HttpCode, HttpStatus, Post, Request } from '@nestjs/common';
import { ADMIN, SUPER_ADMIN } from 'src/common/constants/roles';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { AuthService } from './auth.service';
import { signInDto } from './dto/signIn.dto';
import { inviteDto } from './dto/invite.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  signIn(@Body() signIn: signInDto) {
    return this.authService.signIn(signIn.email, signIn.password);
  }

  @Post('invite')
  @Roles([ADMIN, SUPER_ADMIN])
  invite(@Body() invitation: inviteDto) {
    return this.authService.invite(invitation);
  }

  /**
  @Post('register')
  @Roles([CLIENT])
  register(@Body() register: registerDto) {
    return this.authService.invite(register.invite);
  }
  */

  @Get('profile')
  getProfile(@Request() req) {
    return req.user;
  }
}
