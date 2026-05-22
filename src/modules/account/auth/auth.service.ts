import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { VALID_GLOBAL_ROLES, VALID_PROVIDER_ROLES } from 'src/common/constants/roles';
import { computeEffectiveConfig } from '@courthive/provider-config';
import { createUniqueKey } from './helpers/createUniqueKey';
import { UsersService } from '../../users/users.service';
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

    // Admin-assigned passwords gate into a forced-change flow before a
    // full session is issued. Return a short-lived limited token whose
    // sole purpose is to authenticate the /auth/complete-first-login call.
    if (user.mustChangePassword) {
      const limitedToken = await this.jwtService.signAsync(
        { email: user.email, purpose: 'first-login-password-change' },
        { expiresIn: '5m' },
      );
      return { mustChangePassword: true, limitedToken };
    }

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

    // Multi-provider session context. Load the user's full set of provider
    // associations from user_providers so TMX can surface them in the
    // provider switcher and resolve the active session provider. See
    // Mentat/planning/MULTI_PROVIDER_SESSION_CONTEXT.md for the design.
    //
    // `lastSelectedProviderId` was loaded with the user record (above). If
    // the persisted value no longer matches any current association (e.g.
    // the association was revoked between sessions), nullify it so the
    // TMX-side precedence falls through to the legacy provider_id default.
    if (user.userId) {
      try {
        const enriched = await this.userProviderStorage.findByUserIdEnriched(user.userId);
        const associations = enriched.map((row) => ({
          providerId: row.providerId,
          providerRole: row.providerRole,
          organisationName: row.organisationName,
          organisationAbbreviation: row.organisationAbbreviation,
        }));
        userDetails.providerAssociations = associations;
        if (userDetails.lastSelectedProviderId) {
          const stillValid = associations.some((a) => a.providerId === userDetails.lastSelectedProviderId);
          if (!stillValid) userDetails.lastSelectedProviderId = null;
        }
      } catch (err) {
        Logger.warn(`Failed to load providerAssociations for ${email}: ${(err as Error).message}`);
        userDetails.providerAssociations = [];
      }
    }

    const payload = userDetails;
    const token = await this.jwtService.signAsync(payload, { expiresIn: '1d' });
    return { token };
  }

  /**
   * PATCH /auth/me/last-selected-provider — persist the user's active
   * provider context across devices. Caller's userId comes from the
   * authenticated JWT. Validates `providerId` against `user_providers`;
   * rejects with `{ error: ... }` if the caller is not associated.
   * Pass `null` to clear.
   */
  async updateLastSelectedProvider(email: string, providerId: string | null) {
    if (!email) return { error: 'Authentication required' };
    if (providerId !== null) {
      const user = await this.usersService.findOne(email);
      if (!user?.userId) return { error: 'User not found' };
      const associations = await this.userProviderStorage.findByUserId(user.userId);
      const allowed = associations.some((a) => a.providerId === providerId);
      if (!allowed) return { error: 'Not authorised for that provider' };
    }
    return await this.userStorage.updateLastSelectedProviderId(email, providerId);
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
   * Create a user directly with an assigned password. Replaces the
   * invite-by-URL flow. Returns the assigned password ONCE so the admin
   * can hand it to the new user; the DB stores only the bcrypt hash.
   *
   * Authorization:
   *   - SUPER_ADMIN: unrestricted, providerId optional
   *   - PROVIDER_ADMIN / PROVISIONER: providerId REQUIRED, scope enforced
   *     via assertProviderEditor()
   *
   * The created user is flagged `mustChangePassword=true`, which gates the
   * signIn path into a limited-token response that the client must satisfy
   * by POSTing to /auth/complete-first-login before receiving a full JWT.
   */
  async adminCreateUser(
    body: {
      email: string;
      password?: string;
      providerId?: string;
      providerRole?: string;
      firstName?: string;
      lastName?: string;
      phone?: string;
      roles?: string[];
      permissions?: string[];
      services?: string[];
    },
    editor?: { userContext?: UserContext; provisionerIds?: string[] },
  ) {
    const email = (body?.email ?? '').toLowerCase().trim();
    if (!email) return { error: 'Email is required' };

    const requestedRoles: string[] = body?.roles ?? [];
    const invalidRoles = requestedRoles.filter((r) => !ALLOWED_ROLE_SET.has(r));
    if (invalidRoles.length) {
      return { error: `Invalid role(s): ${invalidRoles.join(', ')}` };
    }

    const providerRole: string =
      body?.providerRole === 'PROVIDER_ADMIN' ? 'PROVIDER_ADMIN' : 'DIRECTOR';

    const providerId = body?.providerId?.trim() || undefined;
    const editorContext = editor?.userContext;
    if (!editorContext?.isSuperAdmin) {
      if (!providerId) {
        throw new BadRequestException('providerId is required when the editor is not SUPER_ADMIN');
      }
      await assertProviderEditor({
        userContext: editorContext,
        providerId,
        provisionerIds: editor?.provisionerIds,
        provisionerProviderStorage: this.provisionerProviderStorage,
      });
    }

    const existing = await this.usersService.findOne(email);
    if (existing?.email) {
      throw new ConflictException(
        'A user with that email already exists. Use the existing-user association flow to add them to a provider.',
      );
    }

    const supplied = (body?.password ?? '').trim();
    const password = supplied || createUniqueKey().slice(0, 12);

    const result: any = await this.usersService.create({
      firstName: body.firstName,
      lastName: body.lastName,
      phone: body.phone,
      roles: body.roles ?? [],
      permissions: body.permissions ?? [],
      services: body.services,
      email,
      password,
      mustChangePassword: true,
    } as any);
    if (result?.error) return result;

    if (providerId) {
      const created = await this.usersService.findOne(email);
      const userId = created?.userId ?? created?.user_id;
      if (userId) {
        try {
          await this.userProviderStorage.upsert({ userId, providerId, providerRole });
        } catch (err) {
          Logger.warn(
            `Failed to upsert user_providers row for ${email}: ${(err as Error).message}`,
          );
        }
      }
    }

    return { success: true, email, password, providerId, providerRole };
  }

  /**
   * Complete the forced first-login password change. Called after signIn
   * returns `{ mustChangePassword: true, limitedToken }` for a user whose
   * password was assigned by an admin. The limited token's `purpose` claim
   * is verified, the new password is hashed and written, the flag is
   * cleared atomically, and a full JWT is issued via a fresh signIn.
   */
  async completeFirstLogin(limitedToken: string, newPassword: string) {
    if (!limitedToken || !newPassword) {
      return { error: 'limitedToken and newPassword are required' };
    }
    let claims: any;
    try {
      claims = await this.jwtService.verifyAsync(limitedToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired first-login token');
    }
    if (claims?.purpose !== 'first-login-password-change' || !claims?.email) {
      throw new UnauthorizedException('Token is not a first-login token');
    }
    const email = String(claims.email).toLowerCase().trim();
    const user = await this.usersService.findOne(email);
    if (!user) throw new UnauthorizedException();
    if (!user.mustChangePassword) {
      // Idempotent: if the flag was already cleared (e.g. user retried),
      // still attempt the password set so they aren't locked out, but
      // emit a warning.
      Logger.warn(`completeFirstLogin called for ${email} but mustChangePassword is already false`);
    }
    const hashed = await hashPassword(newPassword);
    await this.userStorage.completeFirstLogin(email, hashed);
    return await this.signIn(email, newPassword);
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
