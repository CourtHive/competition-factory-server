import { Body, Controller, HttpCode, HttpStatus, Inject, Logger, Post, Req, UseGuards } from '@nestjs/common';
import { SplitTokenSigner } from 'src/services/split-token-signer.service';
import { Public } from '../account/auth/decorators/public.decorator';
import { RefreshTokenService } from 'src/services/refresh-token.service';
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
  USER_PROVISIONER_STORAGE,
  type IUserProvisionerStorage,
  PROVISIONER_PROVIDER_STORAGE,
  type IProvisionerProviderStorage,
  PROVIDER_STORAGE,
  type IProviderStorage,
} from 'src/storage/interfaces';
import { resolveActingProviderId } from 'src/common/auth/actingProvider';
import { buildUserContext } from '../account/auth/helpers/buildUserContext';

const HANDOFF_REFUSED =
  'SSO identity not found for a provider this provisioner manages — create the user first via POST /provisioner/users';

@Controller('auth/sso')
export class SsoController {
  constructor(
    private readonly ssoTokenService: SsoTokenService,
    private readonly jwtService: JwtService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly splitTokenSigner: SplitTokenSigner,
    @Inject(SSO_IDENTITY_STORAGE) private readonly ssoIdentityStorage: ISsoIdentityStorage,
    @Inject(USER_STORAGE) private readonly userStorage: IUserStorage,
    @Inject(USER_PROVIDER_STORAGE) private readonly userProviderStorage: IUserProviderStorage,
    @Inject(USER_PROVISIONER_STORAGE) private readonly userProvisionerStorage: IUserProvisionerStorage,
    @Inject(PROVISIONER_PROVIDER_STORAGE)
    private readonly provisionerProviderStorage: IProvisionerProviderStorage,
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
    const { externalId, ssoProvider, providerId } = body ?? ({} as any);
    if (!externalId || !ssoProvider || !providerId) {
      return { error: 'externalId, ssoProvider, and providerId are required' };
    }

    // A request that names its provider in X-Provider-Id must hand off for that same provider.
    const headerProviderId = req.headers?.['x-provider-id'];
    if (headerProviderId && headerProviderId !== providerId) {
      return { error: 'providerId does not match X-Provider-Id', code: 'SSO_PROVIDER_MISMATCH' };
    }

    // ISSUER SCOPE (PROVISIONER-SSO-101). A valid provisioner credential is not authority over every SSO identity:
    // the provisioner must manage the provider it hands off for, and the identity's user must belong to that
    // provider. Not-found and not-authorized refuse identically, so an unrelated provisioner cannot probe which
    // (ssoProvider, externalId) pairs exist.
    const identity = await this.findAuthorizedIdentity(
      req.provisioner.provisionerId,
      providerId,
      ssoProvider,
      externalId,
    );
    if (!identity) return { error: HANDOFF_REFUSED, code: 'SSO_IDENTITY_NOT_FOUND' };

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
  async loginWithToken(@Body() body: { token: string }, @Req() req?: any) {
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

    // Re-check issuer scope at consume: a relationship revoked (or a user removed from the provider) in the token's
    // lifetime must not still be redeemable, and a token minted before this check existed must not bypass it.
    if (!(await this.isWithinIssuerScope(payload.provisionerId, payload.providerId, identity.userId))) {
      return { error: 'SSO handoff is no longer authorized', code: 'SSO_HANDOFF_UNAUTHORIZED' };
    }

    // Fetch the full user record
    const user = await this.findUserById(identity.userId);
    if (!user) {
      return { error: 'User record not found' };
    }

    // Build user context for the JWT
    const userContext = await buildUserContext(user, {
      userProviderStorage: this.userProviderStorage,
      userProvisionerStorage: this.userProvisionerStorage,
      provisionerProviderStorage: this.provisionerProviderStorage,
    });

    // Issue JWT — strip password from payload
    const userDetails = { ...user };
    delete userDetails.password;
    // THE PROVIDER THIS SESSION ACTS FOR. The handoff token was issued by a provisioner's platform FOR one
    // provider (`payload.providerId`): that is the session's provider, if the user may act for it. Never the
    // raw `users.provider_id` column the spread above carries. See MULTI_PROVIDER_CONTEXT_COMPLETION.md.
    const actingProviderId = resolveActingProviderId({
      requested: payload.providerId ?? undefined,
      associatedIds: userContext.providerIds,
      provisionerProviderIds: userContext.provisionerProviderIds ?? [],
      isSuperAdmin: userContext.isSuperAdmin,
    });
    delete userDetails.providerId;
    const jwtPayload = {
      ...userDetails,
      providerIds: userContext.providerIds,
      providerRoles: userContext.providerRoles,
      ...(actingProviderId ? { providerId: actingProviderId } : {}),
      providerSelectionRequired: !actingProviderId && !userContext.isSuperAdmin && userContext.providerIds.length > 1,
    };
    // Match the direct-login access-token lifetime (auth.service.ts ACCESS_TOKEN_TTL
    // = 4h) and its `aud: 'admin'` session audience — a bare session token is
    // treated as 'admin' at every verifier, so this is behaviorally identical and
    // more explicit. Signing is delegated to the IdP via SplitTokenSigner (local
    // in-process pre-cutover): the SSO handoff is the second session-issuer flagged
    // in ACCOUNT_SERVICE_BOUNDARY, now keyless like every other mint site. The
    // refresh token below keeps the session alive silently past the 4h access TTL.
    const accessToken = await this.splitTokenSigner.mint(this.jwtService, {
      claims: jwtPayload,
      audience: 'admin',
      expiresInSeconds: 14400,
    });

    // Mint a rotating refresh token so SSO-handoff sessions refresh silently
    // just like password logins (POST /auth/refresh) instead of forcing a new
    // provisioner handoff every few hours.
    const refreshToken = await this.refreshTokenService.issue(
      userContext.userId,
      userContext.email,
      req?.headers?.['user-agent'],
      // pinned, so a refreshed session stays on the provider the handoff named
      payload.providerId && actingProviderId === payload.providerId ? actingProviderId : undefined,
    );

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
      refreshToken,
      user: {
        userId: userContext.userId,
        email: userContext.email,
        providerIds: userContext.providerIds,
        providerRoles: userContext.providerRoles,
      },
    };
  }

  /**
   * The SSO identity, when it exists and is within the provisioner's issuer scope for `providerId`; otherwise null.
   * The relationship is checked first, so an unrelated provisioner triggers no identity lookup at all.
   */
  private async findAuthorizedIdentity(
    provisionerId: string | undefined,
    providerId: string | undefined,
    ssoProvider: string,
    externalId: string,
  ) {
    if (!(await this.managesProvider(provisionerId, providerId))) return null;
    const identity = await this.ssoIdentityStorage.findByExternalId(ssoProvider, externalId);
    if (!identity) return null;
    return (await this.isWithinIssuerScope(provisionerId, providerId, identity.userId)) ? identity : null;
  }

  /**
   * True when `provisionerId` manages `providerId` (owner or subsidiary) and `userId` is associated with
   * `providerId`. Storage errors refuse (fail closed).
   */
  private async isWithinIssuerScope(provisionerId: string | undefined, providerId: string | undefined, userId: string) {
    if (!(await this.managesProvider(provisionerId, providerId))) return false;
    try {
      return !!(await this.userProviderStorage.findOne(userId, providerId as string));
    } catch (err: any) {
      Logger.warn(`SSO issuer-scope membership check failed closed: ${err?.message ?? err}`, SsoController.name);
      return false;
    }
  }

  private async managesProvider(provisionerId: string | undefined, providerId: string | undefined) {
    if (!provisionerId || !providerId) return false;
    try {
      return !!(await this.provisionerProviderStorage.getRelationship(provisionerId, providerId));
    } catch (err: any) {
      Logger.warn(`SSO issuer-scope relationship check failed closed: ${err?.message ?? err}`, SsoController.name);
      return false;
    }
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
