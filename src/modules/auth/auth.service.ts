import { ForbiddenException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { VALID_GLOBAL_ROLES, VALID_PROVIDER_ROLES } from 'src/common/constants/roles';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { computeEffectiveConfig } from '../providers/effective-provider-config';
import { createUniqueKey } from './helpers/createUniqueKey';
import { UsersService } from '../users/users.service';
import { hashPassword } from './helpers/hashPassword';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';

// constants and interfaces
import { SUCCESS } from 'src/common/constants/app';
import { PROVISIONER as PROVISIONER_ROLE, SUPER_ADMIN } from 'src/common/constants/roles';
import {
  PROVIDER_STORAGE,
  type IProviderStorage,
  AUTH_CODE_STORAGE,
  type IAuthCodeStorage,
  USER_STORAGE,
  type IUserStorage,
  USER_PROVISIONER_STORAGE,
  type IUserProvisionerStorage,
  USER_PROVIDER_STORAGE,
  type IUserProviderStorage,
  PROVISIONER_PROVIDER_STORAGE,
  type IProvisionerProviderStorage,
} from 'src/storage/interfaces';
import { assertProviderEditor } from './helpers/assertProviderEditor';
import type { UserContext } from './decorators/user-context.decorator';

const ALLOWED_ROLE_SET = new Set([...VALID_GLOBAL_ROLES, ...VALID_PROVIDER_ROLES, 'admin', 'official', 'director']);

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    @Inject(PROVIDER_STORAGE) private readonly providerStorage: IProviderStorage,
    @Inject(AUTH_CODE_STORAGE) private readonly authCodeStorage: IAuthCodeStorage,
    @Inject(USER_STORAGE) private readonly userStorage: IUserStorage,
    @Inject(USER_PROVISIONER_STORAGE) private readonly userProvisionerStorage: IUserProvisionerStorage,
    @Inject(USER_PROVIDER_STORAGE) private readonly userProviderStorage: IUserProviderStorage,
    @Inject(PROVISIONER_PROVIDER_STORAGE)
    private readonly provisionerProviderStorage: IProvisionerProviderStorage,
  ) {}

  async signIn(email: string, clearTextPassword: string) {
    if (!email) throw new UnauthorizedException();
    const user = await this.usersService.findOne(email);

    // SSO-only users have empty password — reject direct login
    if (user && !user.password) {
      throw new UnauthorizedException('This account uses SSO login. Please log in through your organization.');
    }

    const { password, ...userDetails } = user ?? {};
    const passwordMatch =
      user && (password === clearTextPassword || (await bcrypt.compare(clearTextPassword, user?.password)));
    if (!passwordMatch) throw new UnauthorizedException();
    if (user.providerId) {
      const provider = await this.providerStorage.getProvider(user.providerId);
      userDetails.provider = provider;
      // Two-tier provider config: compute effective shape (caps ∩ settings)
      // and embed in the login response so TMX can apply it immediately.
      // Provider switcher / impersonation uses GET /api/provider/:id/effective-config
      // for runtime refetch — see Mentat/planning/TMX_PROVIDER_CONFIG_FEATURES.md.
      userDetails.activeProviderConfig = computeEffectiveConfig(
        provider?.providerConfigCaps,
        provider?.providerConfigSettings,
      );
    }

    // Track last access time for user and their provider. Failures are
    // non-fatal but must be visible — silent .catch() previously masked
    // case-mismatch and connection bugs that produced stale `last_access`
    // columns in the admin UI.
    //
    // Super-admin access never counts toward a provider's activity (they're
    // operating on every provider; crediting their home provider would be
    // misleading). User-level lastAccess always updates regardless of role.
    const isSuperAdmin = (user.roles ?? []).includes(SUPER_ADMIN);
    this.userStorage.updateLastAccess(email).catch((err: any) => {
      Logger.warn(`updateLastAccess(user=${email}) failed: ${err?.message ?? err}`, AuthService.name);
    });
    if (user.providerId && !isSuperAdmin) {
      const providerId = user.providerId;
      this.providerStorage.updateLastAccess(providerId).catch((err: any) => {
        Logger.warn(`updateLastAccess(provider=${providerId}) failed: ${err?.message ?? err}`, AuthService.name);
      });
    }

    // Phase 2A: PROVISIONER-role users carry their provisioner associations
    // in the JWT so the provisioner middleware can resolve them on every
    // request without a DB lookup.
    if (user.userId && user.roles?.includes(PROVISIONER_ROLE)) {
      try {
        userDetails.provisionerIds = await this.userProvisionerStorage.findProvisionerIdsByUser(user.userId);
      } catch (err) {
        Logger.warn(`Failed to load provisionerIds for ${email}: ${(err as Error).message}`);
        userDetails.provisionerIds = [];
      }
    }

    const payload = userDetails;
    const token = await this.jwtService.signAsync(payload, { expiresIn: '1d' });
    return { token };
  }

  /**
   * Invite a user to a provider.
   *
   * Two paths:
   *
   *   - Existing email — skip user creation, upsert a user_providers row
   *     at the inviter's chosen provider, return `{ existingUser: true }`.
   *     No invite code; the user already has credentials.
   *
   *   - New email — create the invite code as today, but also persist
   *     `providerId` + `providerRole` in the cached invite payload so
   *     `register()` can lay down the corresponding user_providers row
   *     when the invitee accepts.
   *
   * Authorization: the inviter must have edit authority at `providerId`.
   * Super-admins are unrestricted; PROVIDER_ADMIN editors are confined
   * to their own provider; provisioners are confined to providers they
   * administer. Enforced via `assertProviderEditor`.
   */
  async invite(
    invitation: any,
    editor?: { userContext?: UserContext; provisionerIds?: string[] },
  ) {
    const email = invitation?.email ?? '';
    if (!email) return { error: 'Email is required' };

    // Validate roles against the whitelist — reject unknown role strings
    const requestedRoles: string[] = invitation?.roles ?? [];
    const invalidRoles = requestedRoles.filter((r) => !ALLOWED_ROLE_SET.has(r));
    if (invalidRoles.length) {
      return { error: `Invalid role(s): ${invalidRoles.join(', ')}` };
    }

    const providerId: string | undefined = invitation?.providerId;
    const providerRole: string =
      invitation?.providerRole === 'PROVIDER_ADMIN' ? 'PROVIDER_ADMIN' : 'DIRECTOR';

    if (!providerId) return { error: 'providerId required' };

    // Editor must have authority at the chosen provider — same rule
    // applied by the user-provider CRUD controller.
    await assertProviderEditor({
      userContext: editor?.userContext,
      providerId,
      provisionerIds: editor?.provisionerIds,
      provisionerProviderStorage: this.provisionerProviderStorage,
    });

    const user = await this.usersService.findOne(email);
    if (user?.email) {
      // Existing-email path: associate, no invite code.
      const userId = user.userId ?? user.user_id;
      if (!userId) return { error: 'Existing user has no userId' };
      await this.userProviderStorage.upsert({ userId, providerId, providerRole });
      return { success: true, existingUser: true, providerId, providerRole };
    }

    // New-email path: persist provider context in the cached invite so
    // register() can stamp the user_providers row on accept.
    const inviteCode = createUniqueKey();
    const cachedInvite = { ...invitation, providerId, providerRole };
    await this.cacheManager.set(`invite:${inviteCode}`, cachedInvite, 60 * 60 * 24 * 1000);

    Logger.verbose(`Invite code: ${inviteCode}, Email: ${email}`);
    return { success: true, existingUser: false, inviteCode };
  }

  async register(invitation: any) {
    const { code, ...details } = invitation;
    const invite: any = await this.cacheManager.get(`invite:${code}`);
    if (!invite) throw new UnauthorizedException('Invalid invitation code');
    await this.cacheManager.del(`invite:${code}`);

    const result: any = await this.usersService.create({ ...details, ...invite });
    if (result.error) return result;

    // If the invite carried a provider context, lay down the
    // user_providers row now so the new user lands with the correct
    // per-provider scope role.
    if (invite.providerId && invite.providerRole) {
      const created = await this.usersService.findOne(invite.email);
      const userId = created?.userId ?? created?.user_id;
      if (userId) {
        try {
          await this.userProviderStorage.upsert({
            userId,
            providerId: invite.providerId,
            providerRole: invite.providerRole,
          });
        } catch (err) {
          // Non-fatal: user is created, association can be repaired by
          // an admin later. Log so we know if this surfaces.
          Logger.warn(
            `Failed to upsert user_providers row for ${invite.email}: ${(err as Error).message}`,
          );
        }
      }
    }

    return { ...SUCCESS };
  }

  // TODO: implement forgot password code
  async forgotPassword(email: string) {
    const user = await this.usersService.findOne(email);
    if (!user) return { error: 'User not found' };
    const code = Math.floor(100000 + Math.random() * 900000);
    await this.authCodeStorage.setResetCode(String(code), email);

    /**
    await sendEmailHTML({
      to: email,
      subject: `Reset Password Code: ${code}`,
      templateName: 'resetPassword',
      templateData: { code },
    });
    */
    return email;
  }

  // TODO: implement password reset
  async resetPassword(code: string, newPassword: string) {
    const resetDetails: any = await this.authCodeStorage.getResetCode(code);
    await this.authCodeStorage.deleteResetCode(code);
    if (!resetDetails?.email) return { error: 'Invalid reset code' };
    const user = await this.usersService.findOne(resetDetails?.email);
    if (!user) return { error: 'User not found' };
    user.password = await hashPassword(newPassword);
    await this.userStorage.update(user.email, user);
    return { ...SUCCESS };
  }

  /**
   * Reset a user's password as an administrator.
   *
   * Authorization: SUPER_ADMIN unrestricted. Otherwise the editor must
   * have edit authority at *at least one* of the target user's
   * `user_providers` associations — i.e. PROVIDER_ADMIN or
   * PROVISIONER administering one of the target's providers.
   *
   * If the target user has no provider associations, only SUPER_ADMIN
   * can reset (the previous behavior).
   */
  async adminResetPassword(
    email: string,
    newPassword?: string,
    editor?: { userContext?: UserContext; provisionerIds?: string[] },
  ) {
    if (!email) return { error: 'Email is required' };
    const user = await this.usersService.findOne(email);
    if (!user) return { error: 'User not found' };

    const editorContext = editor?.userContext;
    if (!editorContext?.isSuperAdmin) {
      // Walk the target's provider associations until we find one the
      // editor has authority over. Pure SUPER_ADMIN short-circuits above.
      const targetUserId = user.userId ?? user.user_id;
      const targetRows = targetUserId
        ? await this.userProviderStorage.findByUserId(targetUserId)
        : [];
      let allowed = false;
      for (const row of targetRows) {
        try {
          await assertProviderEditor({
            userContext: editorContext,
            providerId: row.providerId,
            provisionerIds: editor?.provisionerIds,
            provisionerProviderStorage: this.provisionerProviderStorage,
          });
          allowed = true;
          break;
        } catch {
          // Try the next provider association.
        }
      }
      if (!allowed) {
        throw new ForbiddenException(
          'Not authorised to reset this user\u2019s password',
        );
      }
    }

    const password = newPassword || createUniqueKey().slice(0, 12);
    user.password = await hashPassword(password);
    await this.userStorage.update(email, user);
    return { ...SUCCESS, password };
  }

  /**
   * Self-service password change for a logged-in user. Verifies the
   * current password before writing the new one. Returns 401 on a wrong
   * current-password to keep timing-attack surface flat with sign-in.
   */
  async changePassword(email: string, currentPassword: string, newPassword: string) {
    if (!email || !currentPassword || !newPassword) {
      return { error: 'Email, currentPassword, and newPassword are required' };
    }
    const user = await this.usersService.findOne(email);
    if (!user?.password) throw new UnauthorizedException();

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) throw new UnauthorizedException();

    const updated = { ...user, password: await hashPassword(newPassword) };
    await this.userStorage.update(email, updated);
    return { ...SUCCESS };
  }

  async modifyUser(params: { email: string; [key: string]: any }) {
    const { email, ...updates } = params;
    if (!email) return { error: 'Email is required' };

    const user = await this.usersService.findOne(email);
    if (!user) return { error: 'User not found' };

    const merged = { ...user, ...updates };
    await this.userStorage.update(email, merged);
    const { password: _, ...safeUser } = merged; // eslint-disable-line @typescript-eslint/no-unused-vars
    return { success: true, user: safeUser };
  }

  async removeUser(params: any) {
    return await this.usersService.remove(params.email);
  }

  async getUsers() {
    return await this.usersService.findAll();
  }

  async decode(token: string) {
    try {
      return await this.jwtService.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Incorrect auth token.');
    }
  }
}
