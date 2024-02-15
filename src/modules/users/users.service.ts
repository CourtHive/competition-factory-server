import netLevel from 'src/services/levelDB/netLevel';
import { Injectable } from '@nestjs/common';

import { ADMIN, CLIENT, DEVELOPER, SCORE } from 'src/common/constants/roles';
import { TEST_EMAIL, TEST_PASSWORD } from 'src/common/constants/test';
import { DEV_MODE } from 'src/common/constants/permissions';
import { BASE_USER } from 'src/services/levelDB/constants';
import { hashPassword } from '../auth/helpers/hashPassword';

type User = {
  permissions?: string[];
  password: string;
  roles?: string[];
  email: string;
};

@Injectable()
export class UsersService {
  private users: any[] = [
    {
      roles: [ADMIN, DEVELOPER, CLIENT, SCORE],
      permissions: [DEV_MODE],
      password: TEST_PASSWORD,
      email: TEST_EMAIL,
    },
  ];

  async findOne(email: string): Promise<User | undefined> {
    return this.users.find((user) => user.email === email);
  }

  async create(user: User): Promise<User> {
    const { password, ...value } = user;
    const storageRecord = {
      value: { ...value, password: hashPassword(password) },
      key: user.email,
    };
    netLevel.set(BASE_USER, storageRecord);
    return user;
  }
}
