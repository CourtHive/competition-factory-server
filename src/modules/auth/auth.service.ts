import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { createUniqueKey } from './helpers/createUniqueKey';
import { UsersService } from '../users/users.service';
import { hashPassword } from './helpers/hashPassword';
import netLevel from 'src/services/levelDB/netLevel';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';

import { BASE_PROVIDER, BASE_RESET_CODES, BASE_USER } from 'src/services/levelDB/constants';
import { SUCCESS } from 'src/common/constants/app';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async signIn(email: string, clearTextPassword: string) {
    const user = await this.usersService.findOne(email);
    const { password, ...userDetails } = user;
    const passwordMatch =
      user && (password === clearTextPassword || (await bcrypt.compare(clearTextPassword, user.password)));
    if (!passwordMatch) throw new UnauthorizedException();
    if (user.providerId) {
      const provider = await netLevel.get(BASE_PROVIDER, { key: user.providerId });
      userDetails.provider = provider;
    }

    const payload = userDetails;
    return {
      token: await this.jwtService.signAsync(payload),
    };
  }

  async invite(invitation: any) {
    const { email } = invitation;

    const user = await this.usersService.findOne(email);
    if (user?.email) return { error: 'Existing user' };

    const inviteCode = createUniqueKey();
    await this.cacheManager.set(`invite:${inviteCode}`, invitation, 60 * 60 * 24 * 1000);

    Logger.log(`Invite code: ${inviteCode}, Email: ${email}`);
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
    await netLevel.set(BASE_RESET_CODES, { key: code, value: email });

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
    const resetDetails: any = await netLevel.get(BASE_RESET_CODES, { key: code });
    await netLevel.delete(BASE_RESET_CODES, { key: code });
    if (!resetDetails.email) return { error: 'Invalid reset code' };
    const user = await this.usersService.findOne(resetDetails?.email);
    if (!user) return { error: 'User not found' };
    user.password = await hashPassword(newPassword);
    const storageRecord = { key: user.email, value: user };
    return await netLevel.set(BASE_USER, storageRecord);
  }

  async decode(token: string) {
    try {
      return await this.jwtService.verifyAsync(token);
    } catch (e) {
      throw new UnauthorizedException('Incorrect auth token.');
    }
  }
}
