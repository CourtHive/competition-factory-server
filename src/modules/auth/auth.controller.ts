import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ADMIN, SUPER_ADMIN } from 'src/common/constants/roles';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { RegisterDto } from './dto/register.dto';
import { AuthService } from './auth.service';
import { SignInDto } from './dto/signIn.dto';
import { InviteDto } from './dto/invite.dto';
import { RemoveDto } from './dto/remove.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  signIn(@Body() signIn: SignInDto) {
    return this.authService.signIn(signIn.email, signIn.password);
  }

  @Post('invite')
  @Roles([ADMIN, SUPER_ADMIN])
  invite(@Body() invitation: InviteDto) {
    return this.authService.invite(invitation);
  }

  @Post('remove')
  @Roles([SUPER_ADMIN])
  remove(@Body() params: RemoveDto) {
    return this.authService.removeUser(params);
  }

  @Post('allusers')
  @Roles([SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  getProviders() {
    return this.authService.getUsers();
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.OK)
  register(@Body() register: RegisterDto) {
    return this.authService.register(register);
  }
}
