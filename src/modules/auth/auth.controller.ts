import { Body, Controller, Get, HttpCode, HttpStatus, Post, Request } from '@nestjs/common';
import { ADMIN, CLIENT, SUPER_ADMIN } from 'src/common/constants/roles';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { AuthService } from './auth.service';
import { SignInDto } from './dto/signIn.dto';
import { InviteDto } from './dto/invite.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  signIn(@Body() signIn: SignInDto) {
    return this.authService.signIn(signIn.email, signIn.password);
  }

  @Post('invite')
  @Roles([ADMIN, SUPER_ADMIN])
  invite(@Body() invitation: InviteDto) {
    return this.authService.invite(invitation);
  }

  @Post('register')
  @Roles([CLIENT])
  register(@Body() register: RegisterDto) {
    return this.authService.register(register);
  }

  @Get('profile')
  getProfile(@Request() req) {
    return req.user;
  }
}
