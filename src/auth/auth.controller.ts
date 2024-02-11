import { Body, Controller, Get, HttpCode, HttpStatus, Post, Request } from '@nestjs/common';
import { MailgunService } from 'src/modules/mail/mailGun.service';
import { Public } from './decorators/public.decorator';
import { AuthService } from './auth.service';
import { signInDto } from './dto/signIn.dto';
import { getInvite } from './function/getInvite';
import { inviteDto } from './dto/invite.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private readonly mailgunService: MailgunService,
  ) {}

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  signIn(@Body() signIn: signInDto) {
    return this.authService.signIn(signIn.email, signIn.password);
  }

  @Get('profile')
  getProfile(@Request() req) {
    return req.user;
  }

  @Post('invite')
  inviteUser(@Request() iData: inviteDto) {
    const data = getInvite(iData);
    return this.mailgunService.sendMail(data);
  }
}
