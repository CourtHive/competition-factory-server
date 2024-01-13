import { TEST_EMAIL, TEST_PASSWORD } from '../../common/constants/test';
import { Injectable } from '@nestjs/common';

type User = {
  userId: number;
  email: string;
  password: string;
  roles: string[];
};

@Injectable()
export class UsersService {
  private readonly users = [
    {
      roles: ['admin', 'client'],
      password: TEST_PASSWORD,
      email: TEST_EMAIL,
      userId: 1,
    },
  ];

  async findOne(email: string): Promise<User | undefined> {
    return this.users.find((user) => user.email === email);
  }
}
