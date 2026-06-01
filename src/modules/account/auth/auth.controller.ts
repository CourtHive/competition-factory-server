import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Req } from '@nestjs/common';
import { UserCtx, type UserContext } from './decorators/user-context.decorator';
import { AdminCreateUserDto } from './dto/adminCreateUser.dto';
import { ForgotPasswordDto } from './dto/forgotPassword.dto';
import { ResetPasswordDto } from './dto/resetPassword.dto';
import { TrackerTokenDto } from './dto/trackerToken.dto';
import { SUPER_ADMIN, CLIENT, SCORE } from 'src/common/constants/roles';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { User } from './decorators/user.decorator';
import { ModifyUserDto } from './dto/modifyUser.dto';
import { AuthService } from './auth.service';
import { TrackerTokenService } from './tracker-token.service';
import { SignInDto } from './dto/signIn.dto';
import { RemoveDto } from './dto/remove.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly trackerTokenService: TrackerTokenService,
  ) {}

  /**
   * POST /auth/tracker-token — mint a short-lived JWT scoped to a single
   * tournament for use by external score publishers (notably IONSport).
   *
   * Provider API-key middleware grants SCORE; RolesGuard admits. The
   * service runs canMutateTournament against the tournament's parent
   * provider so the caller can only mint for tournaments it owns.
   *
   * Returns { token, expiresAt }. TTL defaults to 1h; max 8h.
   */
  @Post('tracker-token')
  @Roles([SCORE, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  async mintTrackerToken(
    @Body() body: TrackerTokenDto,
    @User() user: any,
    @UserCtx() userContext: UserContext,
    @Req() req?: any,
  ) {
    return this.trackerTokenService.mintTrackerToken(
      { tournamentId: body.tournamentId, ttlSeconds: body.ttlSeconds },
      {
        userId: user?.userId,
        providerId: user?.providerId,
        provisionerId: req?.provisioner?.provisionerId,
      },
      userContext,
    );
  }

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
  signIn(@Body() signIn: SignInDto, @Req() req?: any) {
    return this.authService.signIn(signIn.email, signIn.password, req?.headers?.['user-agent']);
  }

  /**
   * Exchange a rotating refresh token for a fresh access token (+ rotated
   * refresh token). TMX calls this transparently when the access token nears
   * expiry or a request 401s. Public: the refresh token is the credential.
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() body: { refreshToken: string }, @Req() req?: any) {
    return this.authService.refreshSession(body?.refreshToken ?? '', req?.headers?.['user-agent']);
  }

  /**
   * Revoke a refresh token (logout). Idempotent; always returns success so the
   * client can clear local state regardless. Public: the token is the credential.
   */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Body() body: { refreshToken: string }) {
    return this.authService.logout(body?.refreshToken ?? '');
  }

  /**
   * Request a passwordless magic login link. Enumeration-defensive: always
   * returns `{ ok: true }`; a link is sent only to a verified, non-SSO account.
   * Public: the caller is by definition not authenticated.
   */
  @Public()
  @Post('magic/request')
  @HttpCode(HttpStatus.OK)
  requestMagicLink(@Body() body: { email: string }) {
    return this.authService.requestMagicLink(body?.email ?? '');
  }

  /**
   * Consume a magic-link code and issue an access + refresh session. Public:
   * the single-use code is the credential.
   */
  @Public()
  @Post('magic/consume')
  @HttpCode(HttpStatus.OK)
  consumeMagicLink(@Body() body: { code: string }, @Req() req?: any) {
    return this.authService.consumeMagicLink(body?.code ?? '', req?.headers?.['user-agent']);
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
  // CLIENT is the broad gate; the service narrows to SUPER_ADMIN OR
  // PROVIDER_ADMIN / PROVISIONER scoped to one of the target user's
  // provider associations (same pattern as admin-reset-password).
  @Roles([CLIENT, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  modify(
    @Body() params: ModifyUserDto,
    @User() user?: any,
    @UserCtx() userContext?: UserContext,
  ) {
    return this.authService.modifyUser(params, {
      userContext,
      provisionerIds: user?.provisionerIds,
    });
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

  /**
   * Request a password reset. Always returns `{ ok: true }` (enumeration
   * defense) — mail is sent only when the contact_email is registered
   * AND verified. Public: callers are by definition not authenticated.
   */
  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.authService.forgotPassword(body?.contactEmail ?? '');
  }

  /**
   * Apply a password reset using the JWT carried in the link from the
   * reset email. Public: the token IS the auth.
   */
  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() body: ResetPasswordDto) {
    return this.authService.resetPassword(body?.token ?? '', body?.newPassword ?? '');
  }
}
