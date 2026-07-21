import { hashPassword } from 'src/common/helpers/hashPassword';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { USER_STORAGE, type IUserStorage } from 'src/storage/interfaces';
import { ADMIN, CLIENT, DEVELOPER, SCORE, SUPER_ADMIN } from 'src/common/constants/roles';
import { TEST_EMAIL, TEST_PASSWORD, TEST_USER_ID } from 'src/common/constants/test';
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
    @Inject(USER_STORAGE) private readonly userStorage: IUserStorage,
  ) {}

  private readonly testUsers: any[] = [
    {
      userId: TEST_USER_ID,
      roles: [SUPER_ADMIN, ADMIN, DEVELOPER, CLIENT, SCORE],
      permissions: [DEV_MODE],
      password: TEST_PASSWORD,
      email: TEST_EMAIL,
    },
  ];

  async findOne(email: string) {
    const normalizedEmail = email?.toLowerCase().trim();
    const mode = this.configService.get('APP')?.mode;
    const devModeTestUser =
      mode === 'development' && (await this.testUsers.find((user) => user.email === normalizedEmail));
    if (devModeTestUser) return devModeTestUser;
    return await this.userStorage.findOne(normalizedEmail);
  }

  /**
   * Resolve a dev-mode test super-admin by its (synthetic) userId. Returns null
   * outside development or for any id that isn't a test user — so callers can use
   * it as a fallback after a real `userStorage.findByUserId` miss without opening
   * a hole for unknown ids (an unknown userId still resolves to null → 401).
   */
  getDevUserById(userId: string): any | null {
    if (this.configService.get('APP')?.mode !== 'development' || !userId) return null;
    return this.testUsers.find((user) => user.userId === userId) ?? null;
  }

  async create(user: User) {
    const { password, email, ...value } = user;
    if (!password) return { error: 'Password is required' };
    const hashedUser = { ...value, email: email?.toLowerCase().trim(), password: await hashPassword(password) };
    return await this.userStorage.create(hashedUser as any);
  }

  async remove(email: string) {
    const normalizedEmail = email?.toLowerCase().trim();
    await this.userStorage.remove(normalizedEmail);
    return { ...SUCCESS };
  }

  async findAll() {
    return await this.userStorage.findAll();
  }
}
