import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { VALID_GLOBAL_ROLES, VALID_PROVIDER_ROLES } from 'src/common/constants/roles';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { createUniqueKey } from './helpers/createUniqueKey';
import { UsersService } from '../users/users.service';
import { hashPassword } from './helpers/hashPassword';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';

// constants and interfaces
import { SUCCESS } from 'src/common/constants/app';
import { PROVISIONER as PROVISIONER_ROLE } from 'src/common/constants/roles';
import {
  PROVIDER_STORAGE,
  type IProviderStorage,
  AUTH_CODE_STORAGE,
  type IAuthCodeStorage,
  USER_STORAGE,
  type IUserStorage,
  USER_PROVISIONER_STORAGE,
  type IUserProvisionerStorage,
} from 'src/storage/interfaces';

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
    }

    // Track last access time for user and their provider. Failures are
    // non-fatal but must be visible — silent .catch() previously masked
    // case-mismatch and connection bugs that produced stale `last_access`
    // columns in the admin UI.
    this.userStorage.updateLastAccess(email).catch((err: any) => {
      Logger.warn(`updateLastAccess(user=${email}) failed: ${err?.message ?? err}`, AuthService.name);
    });
    if (user.providerId) {
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

  async invite(invitation: any) {
    const email = invitation?.email ?? '';
    if (!email) return { error: 'Email is required' };

    // Validate roles against the whitelist — reject unknown role strings
    const requestedRoles: string[] = invitation?.roles ?? [];
    const invalidRoles = requestedRoles.filter((r) => !ALLOWED_ROLE_SET.has(r));
    if (invalidRoles.length) {
      return { error: `Invalid role(s): ${invalidRoles.join(', ')}` };
    }

    const user = await this.usersService.findOne(email);
    if (user?.email) return { error: 'Existing user' };

    const inviteCode = createUniqueKey();
    await this.cacheManager.set(`invite:${inviteCode}`, invitation, 60 * 60 * 24 * 1000);

    Logger.verbose(`Invite code: ${inviteCode}, Email: ${email}`);
    /**
      await sendEmailHTML({
        to: email,
        subject: 'Invitation',
        templateName: 'userInvitation',
        templateData: {
          invitationLink: `/newUser?code=${inviteCode}`,
        },
      });
     */
    return { inviteCode };
  }

  async register(invitation: any) {
    const { code, ...details } = invitation;
    const invite = await this.cacheManager.get(`invite:${code}`);
    if (!invite) throw new UnauthorizedException('Invalid invitation code');
    await this.cacheManager.del(`invite:${code}`);
    const result: any = await this.usersService.create({ ...details, ...invite });
    if (result.error) return result;
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

  async adminResetPassword(email: string, newPassword?: string) {
    if (!email) return { error: 'Email is required' };
    const user = await this.usersService.findOne(email);
    if (!user) return { error: 'User not found' };

    const password = newPassword || createUniqueKey().slice(0, 12);
    user.password = await hashPassword(password);
    await this.userStorage.update(email, user);
    return { ...SUCCESS, password };
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
