import { createUniqueKey } from '../auth/helpers/createUniqueKey';
import { hashPassword } from '../auth/helpers/hashPassword';
import netLevel from 'src/services/levelDB/netLevel';
import { ConfigService } from '@nestjs/config';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { ADMIN, CLIENT, DEVELOPER, SCORE, SUPER_ADMIN } from 'src/common/constants/roles';
import { BASE_ACCESS_CODES, BASE_USER } from 'src/services/levelDB/constants';
import { TEST_EMAIL, TEST_PASSWORD } from 'src/common/constants/test';
import { DEV_MODE } from 'src/common/constants/permissions';
import { SUCCESS } from 'src/common/constants/app';

type User = {
  permissions?: string[];
  firstName?: string;
  lastName?: string;
  password: string;
  roles?: string[];
  email: string;
};

@Injectable()
export class UsersService {
  constructor(
    private readonly configService: ConfigService,
    private jwtService: JwtService,
  ) {}

  private testUsers: any[] = [
    {
      roles: [SUPER_ADMIN, ADMIN, DEVELOPER, CLIENT, SCORE],
      permissions: [DEV_MODE],
      password: TEST_PASSWORD,
      email: TEST_EMAIL,
    },
  ];

  async findOne(email: string) {
    const mode = this.configService.get('APP')?.mode;
    const devModeTestUser = mode === 'development' && (await this.testUsers.find((user) => user.email === email));
    if (devModeTestUser) return devModeTestUser;
    return await netLevel.get(BASE_USER, { key: email });
  }

  async create(user: User) {
    const { password, ...value } = user;
    if (!password) return { error: 'Password is required' };
    const storageRecord = {
      value: { ...value, password: await hashPassword(password) },
      key: value.email,
    };
    await netLevel.set(BASE_USER, storageRecord);
    return user;
  }

  async remove(email: string) {
    const result = await netLevel.delete(BASE_USER, { key: email });
    console.log('remove result', { key: email }, result);
    return { ...SUCCESS };
  }

  async findAll() {
    const users = await netLevel.list(BASE_USER, { all: true });
    if (!users) return { success: false, message: 'No users found' };
    return { ...SUCCESS, users };
  }

  // TODO: implement this method in controller
  async useMagic(code: string) {
    const email = await netLevel.get(BASE_ACCESS_CODES, { key: code });
    const userRecord: any = await netLevel.get(BASE_USER, { key: email });
    const user = await this.findOne(userRecord.email);
    const payload = { email: user.email, roles: user.roles, permissions: user.permissions };
    return {
      token: await this.jwtService.signAsync(payload),
    };
  }

  async requestMagicLink(email: string) {
    if (!email) return { error: 'Invalid request' };

    const user = await netLevel.get(BASE_USER, { key: email });
    if (!user) {
      return { error: 'User not found' };
    } else {
      const magicLinkCode = createUniqueKey();
      await netLevel.set(`${BASE_ACCESS_CODES}:${magicLinkCode}`, email);

      // TODO: The magic link URL will need to launch the web server / end user app
      /*
      await sendEmailHTML({
        to: email,
        subject: 'Invitation',
        templateName: 'magicLink',
        templateData: {
          magicLink: `/magic?code=${magicLinkCode}`,
        },
      });
      */
      return;
    }
  }
}
