import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { UserCtx, type UserContext } from './decorators/user-context.decorator';
import { ADMIN, SUPER_ADMIN, CLIENT } from 'src/common/constants/roles';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { ModifyUserDto } from './dto/modifyUser.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthService } from './auth.service';
import { SignInDto } from './dto/signIn.dto';
import { InviteDto } from './dto/invite.dto';
import { RemoveDto } from './dto/remove.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Returns the authenticated user's multi-provider context.
   * TMX calls this on app boot and caches the result via getUserContext().
   */
  @Get('me')
  @Roles([CLIENT, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  getMe(@UserCtx() ctx: UserContext) {
    return ctx;
  }

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

  @Post('modify')
  @Roles([SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  modify(@Body() params: ModifyUserDto) {
    return this.authService.modifyUser(params);
  }

  @Post('remove')
  @Roles([SUPER_ADMIN])
  remove(@Body() params: RemoveDto) {
    return this.authService.removeUser(params);
  }

  @Post('admin-reset-password')
  @Roles([SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  adminResetPassword(@Body() body: { email: string; newPassword?: string }) {
    return this.authService.adminResetPassword(body.email, body.newPassword);
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
