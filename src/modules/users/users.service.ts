import { hashPassword } from '../auth/helpers/hashPassword';
import netLevel from 'src/services/levelDB/netLevel';
import { Injectable } from '@nestjs/common';

import { ADMIN, CLIENT, DEVELOPER, SCORE } from 'src/common/constants/roles';
import { TEST_EMAIL, TEST_PASSWORD } from 'src/common/constants/test';
import { DEV_MODE } from 'src/common/constants/permissions';
import { BASE_USER } from 'src/services/levelDB/constants';
import { ConfigService } from '@nestjs/config';

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
  constructor(private readonly configService: ConfigService) {}

  private testUsers: any[] = [
    {
      roles: [ADMIN, DEVELOPER, CLIENT, SCORE],
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
    console.log({ storageRecord });
    await netLevel.set(BASE_USER, storageRecord);
    return user;
  }
}
