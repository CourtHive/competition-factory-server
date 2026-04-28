import { Body, Controller, HttpCode, HttpStatus, Inject, Logger, Post, Req, UseGuards } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { ProvisionerGuard } from './provisioner.guard';
import { SsoTokenService } from './sso-token.service';
import { JwtService } from '@nestjs/jwt';

import {
  SSO_IDENTITY_STORAGE,
  type ISsoIdentityStorage,
  USER_STORAGE,
  type IUserStorage,
  USER_PROVIDER_STORAGE,
  type IUserProviderStorage,
  PROVIDER_STORAGE,
  type IProviderStorage,
} from 'src/storage/interfaces';
import { buildUserContext } from '../auth/helpers/buildUserContext';

@Controller('auth/sso')
export class SsoController {
  constructor(
    private readonly ssoTokenService: SsoTokenService,
    private readonly jwtService: JwtService,
    @Inject(SSO_IDENTITY_STORAGE) private readonly ssoIdentityStorage: ISsoIdentityStorage,
    @Inject(USER_STORAGE) private readonly userStorage: IUserStorage,
    @Inject(USER_PROVIDER_STORAGE) private readonly userProviderStorage: IUserProviderStorage,
    @Inject(PROVIDER_STORAGE) private readonly providerStorage: IProviderStorage,
  ) {}

  /**
   * Generate a one-time SSO token. Called by the provisioner (API key auth)
   * when a user in their system needs to be handed off to TMX.
   */
  @Post('generate')
  @Public()
  @UseGuards(ProvisionerGuard)
  @HttpCode(HttpStatus.OK)
  async generate(@Req() req: any, @Body() body: { externalId: string; ssoProvider: string; providerId: string }) {
    const { externalId, ssoProvider, providerId } = body;
    if (!externalId || !ssoProvider || !providerId) {
      return { error: 'externalId, ssoProvider, and providerId are required' };
    }

    // Verify the user exists in sso_identities
    const identity = await this.ssoIdentityStorage.findByExternalId(ssoProvider, externalId);
    if (!identity) {
      return { error: 'SSO identity not found — create the user first via POST /provisioner/users' };
    }

    const result = await this.ssoTokenService.generate({
      externalId,
      ssoProvider,
      providerId,
      provisionerId: req.provisioner.provisionerId,
    });

    return result;
  }

  /**
   * Exchange a one-time SSO token for a JWT. Called by TMX client after
   * the user is redirected from the provisioner's platform.
   *
   * This is a public endpoint — the token itself is the authentication.
   */
  @Post('login-with-token')
  @Public()
  @HttpCode(HttpStatus.OK)
  async loginWithToken(@Body() body: { token: string }) {
    const { token } = body;
    if (!token) return { error: 'Token is required' };

    // Atomic consume — token is deleted from Redis on read
    const payload = await this.ssoTokenService.consume(token);
    if (!payload) {
      return { error: 'Token expired or not found' };
    }

    // Resolve user from SSO identity
    const identity = await this.ssoIdentityStorage.findByExternalId(payload.ssoProvider, payload.externalId);
    if (!identity) {
      return { error: 'User not found for SSO identity' };
    }

    // Fetch the full user record
    const user = await this.findUserById(identity.userId);
    if (!user) {
      return { error: 'User record not found' };
    }

    // Build user context for the JWT
    const userContext = await buildUserContext(user, this.userProviderStorage);

    // Issue JWT — strip password from payload
    const userDetails = { ...user };
    delete userDetails.password;
    const jwtPayload = { ...userDetails, providerIds: userContext.providerIds, providerRoles: userContext.providerRoles };
    const accessToken = await this.jwtService.signAsync(jwtPayload);

    // Track last access for both user and the provider this SSO token resolved to.
    // Failures are non-fatal but visible — silent .catch() previously hid mismatches.
    // Super-admin access never counts toward provider activity.
    const isSuperAdmin = userContext.isSuperAdmin;
    this.userStorage.updateLastAccess(user.email).catch((err: any) => {
      Logger.warn(`updateLastAccess(user=${user.email}) failed: ${err?.message ?? err}`, SsoController.name);
    });
    if (payload.providerId && !isSuperAdmin) {
      const providerId = payload.providerId;
      this.providerStorage.updateLastAccess(providerId).catch((err: any) => {
        Logger.warn(`updateLastAccess(provider=${providerId}) failed: ${err?.message ?? err}`, SsoController.name);
      });
    }

    return {
      accessToken,
      user: {
        userId: userContext.userId,
        email: userContext.email,
        providerIds: userContext.providerIds,
        providerRoles: userContext.providerRoles,
      },
    };
  }

  /** Find user by userId (not email). The user storage interface uses email as primary lookup. */
  private async findUserById(userId: string): Promise<any | null> {
    // user_providers gives us the email via JOIN, use that
    const rows = await this.userProviderStorage.findByUserId(userId);
    const email = rows[0]?.email;
    if (!email) return null;
    return this.userStorage.findOne(email);
  }
}
