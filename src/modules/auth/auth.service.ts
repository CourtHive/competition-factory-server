import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { createUniqueKey } from './helpers/createUniqueKey';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';

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
    const passwordMatch =
      user && (user.password === clearTextPassword || (await bcrypt.compare(clearTextPassword, user.password)));
    if (!passwordMatch) throw new UnauthorizedException();

    const payload = { email: user.email, roles: user.roles, permissions: user.permissions };
    return {
      token: await this.jwtService.signAsync(payload),
    };
  }

  async invite(invitation: any) {
    const { email } = invitation;
    const inviteCode = createUniqueKey();
    const invitationLink = `/newUser?code=${inviteCode}`;
    await this.cacheManager.set(`invite:${inviteCode}`, invitation, 60 * 60 * 24 * 1000);

    Logger.log(`Invite code: ${inviteCode}, Email: ${email}, InviteLink: ${invitationLink}`);
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
    return { invitationLink };
  }

  async register(invitation: any) {
    const { code, ...details } = invitation;
    const invite = await this.cacheManager.get(`invite:${code}`);
    console.log({ invite });
    if (!invite) {
      throw new UnauthorizedException('Invalid invitation code');
    }
    await this.cacheManager.del(`invite:${code}`);
    const result: any = await this.usersService.create({ ...details, ...invite });
    if (result.error) return result;
    return { ...SUCCESS };
  }
}
