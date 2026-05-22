import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { UserCtx, type UserContext } from './decorators/user-context.decorator';
import { AdminCreateUserDto } from './dto/adminCreateUser.dto';
import { SUPER_ADMIN, CLIENT } from 'src/common/constants/roles';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { User } from './decorators/user.decorator';
import { ModifyUserDto } from './dto/modifyUser.dto';
import { AuthService } from './auth.service';
import { SignInDto } from './dto/signIn.dto';
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

  @Post('admin-create-user')
  // CLIENT is the broad gate; service-layer narrows to SUPER_ADMIN OR
  // PROVIDER_ADMIN/PROVISIONER scoped via assertProviderEditor().
  @Roles([CLIENT, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  adminCreateUser(
    @Body() body: AdminCreateUserDto,
    @User() user?: any,
    @UserCtx() userContext?: UserContext,
  ) {
    return this.authService.adminCreateUser(body, {
      userContext,
      provisionerIds: user?.provisionerIds,
    });
  }

  @Public()
  @Post('complete-first-login')
  @HttpCode(HttpStatus.OK)
  completeFirstLogin(@Body() body: { limitedToken: string; newPassword: string }) {
    return this.authService.completeFirstLogin(body?.limitedToken, body?.newPassword);
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
  // CLIENT is the broad gate; service-layer narrows to SUPER_ADMIN OR
  // PROVIDER_ADMIN/PROVISIONER scoped to one of the target user's
  // provider associations. CLIENT alone cannot reset passwords.
  @Roles([CLIENT, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  adminResetPassword(
    @Body() body: { email: string; newPassword?: string },
    @User() user?: any,
    @UserCtx() userContext?: UserContext,
  ) {
    return this.authService.adminResetPassword(body.email, body.newPassword, {
      userContext,
      provisionerIds: user?.provisionerIds,
    });
  }

  /**
   * Self-service password change for a logged-in user. The middleware
   * already verifies the JWT; we cross-reference its email with the
   * request body so a token can only change its own owner's password.
   */
  @Post('change-password')
  @Roles([CLIENT, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  changePassword(
    @Body() body: { currentPassword: string; newPassword: string },
    @UserCtx() userContext?: UserContext,
  ) {
    if (!userContext?.email) return { error: 'Authentication required' };
    return this.authService.changePassword(
      userContext.email,
      body.currentPassword,
      body.newPassword,
    );
  }

  @Post('allusers')
  @Roles([SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  getProviders() {
    return this.authService.getUsers();
  }

  /**
   * Persist the caller's last-selected provider for multi-provider session
   * context. Reads userId from the JWT, validates the providerId against
   * the caller's `user_providers` associations, and updates
   * `users.last_selected_provider_id`. Pass `providerId: null` to clear.
   *
   * See Mentat/planning/MULTI_PROVIDER_SESSION_CONTEXT.md.
   */
  @Patch('me/last-selected-provider')
  @Roles([CLIENT, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  updateLastSelectedProvider(
    @Body() body: { providerId: string | null },
    @UserCtx() userContext?: UserContext,
  ) {
    if (!userContext?.email) return { error: 'Authentication required' };
    return this.authService.updateLastSelectedProvider(userContext.email, body?.providerId ?? null);
  }

}
