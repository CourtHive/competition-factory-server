import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createUniqueKey } from './helpers/createUniqueKey';
import { UsersService } from '../users/users.service';
import netLevel from 'src/services/levelDB/netLevel';
import { JwtService } from '@nestjs/jwt';

import { BASE_USER_INVITE } from 'src/services/levelDB/constants';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async signIn(email: string, pass: string) {
    const user = await this.usersService.findOne(email);
    if (user?.password !== pass) {
      throw new UnauthorizedException();
    }
    const payload = { email: user.email, sub: user.userId, roles: user.roles };
    return {
      token: await this.jwtService.signAsync(payload),
    };
  }

  async invite(email: string, providerId: string, services: { cacheManager: any }) {
    const inviteCode = createUniqueKey();
    const invitationLink = `/newUser?code=${inviteCode}`;
    const invitation = { providerId };
    await netLevel.set(BASE_USER_INVITE, { key: inviteCode, value: invitation });
    await services.cacheManager.set(inviteCode, invitation, 60 * 60 * 24 * 1000);

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
}
