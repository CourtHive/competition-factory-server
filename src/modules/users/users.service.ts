import { createUniqueKey } from '../account/auth/helpers/createUniqueKey';
import { hashPassword } from '../account/auth/helpers/hashPassword';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { USER_STORAGE, type IUserStorage } from 'src/storage/interfaces';
import { AUTH_CODE_STORAGE, type IAuthCodeStorage } from 'src/storage/interfaces';
import { ADMIN, CLIENT, DEVELOPER, SCORE, SUPER_ADMIN } from 'src/common/constants/roles';
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
    private readonly jwtService: JwtService,
    @Inject(USER_STORAGE) private readonly userStorage: IUserStorage,
    @Inject(AUTH_CODE_STORAGE) private readonly authCodeStorage: IAuthCodeStorage,
  ) {}

  private readonly testUsers: any[] = [
    {
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

  async create(user: User) {
    const { password, email, ...value } = user;
    if (!password) return { error: 'Password is required' };
    const hashedUser = { ...value, email: email?.toLowerCase().trim(), password: await hashPassword(password) };
    return await this.userStorage.create(hashedUser as any);
  }

  async remove(email: string) {
    const normalizedEmail = email?.toLowerCase().trim();
    const result = await this.userStorage.remove(normalizedEmail);
    console.log('remove result', { key: normalizedEmail }, result);
    return { ...SUCCESS };
  }

  async findAll() {
    return await this.userStorage.findAll();
  }

  // TODO: implement this method in controller
  async useMagic(code: string) {
    const email = await this.authCodeStorage.getAccessCode(code);
    const userRecord: any = await this.userStorage.findOne(email);
    const user = await this.findOne(userRecord.email);
    const payload = { email: user.email, roles: user.roles, permissions: user.permissions, services: user.services };
    return {
      token: await this.jwtService.signAsync(payload),
    };
  }

  async requestMagicLink(email: string) {
    if (!email) return { error: 'Invalid request' };
    const normalizedEmail = email.toLowerCase().trim();

    const user = await this.userStorage.findOne(normalizedEmail);
    if (user) {
      const magicLinkCode = createUniqueKey();
      await this.authCodeStorage.setAccessCode(magicLinkCode, normalizedEmail);

      // TODO: The magic link URL will need to launch the web server / end user app
      /*
      // await sendEmailHTML({
      //   to: email,
      //   subject: 'Invitation',
      //   templateName: 'magicLink',
      //   templateData: {
      //     magicLink: `/magic?code=${magicLinkCode}`,
      //   },
      // });
      */
      return;
    } else {
      return { error: 'User not found' };
    }
  }
}
