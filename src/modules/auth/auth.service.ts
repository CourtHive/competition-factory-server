import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { createUniqueKey } from './helpers/createUniqueKey';
import { UsersService } from '../users/users.service';
import { hashPassword } from './helpers/hashPassword';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';

import { PROVIDER_STORAGE, type IProviderStorage } from 'src/storage/interfaces';
import { AUTH_CODE_STORAGE, type IAuthCodeStorage } from 'src/storage/interfaces';
import { USER_STORAGE, type IUserStorage } from 'src/storage/interfaces';
import { SUCCESS } from 'src/common/constants/app';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    @Inject(PROVIDER_STORAGE) private readonly providerStorage: IProviderStorage,
    @Inject(AUTH_CODE_STORAGE) private readonly authCodeStorage: IAuthCodeStorage,
    @Inject(USER_STORAGE) private readonly userStorage: IUserStorage,
  ) {}

  async signIn(email: string, clearTextPassword: string) {
    if (!email) throw new UnauthorizedException();
    const user = await this.usersService.findOne(email);
    const { password, ...userDetails } = user ?? {};
    const passwordMatch =
      user && (password === clearTextPassword || (await bcrypt.compare(clearTextPassword, user?.password)));
    if (!passwordMatch) throw new UnauthorizedException();
    if (user.providerId) {
      const provider = await this.providerStorage.getProvider(user.providerId);
      userDetails.provider = provider;
    }

    const payload = userDetails;
    const token = await this.jwtService.signAsync(payload, { expiresIn: '1d' });
    return { token };
  }

  async invite(invitation: any) {
    const email = invitation?.email ?? '';
    if (!email) return { error: 'Email is required' };

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
