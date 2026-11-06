import { Inject, Injectable } from '@nestjs/common';

import { USER_STORAGE, type IUserStorage } from 'src/storage/interfaces';

/**
 * The `users` row behind a verified token. CFS reads users (to hydrate a request's roles and provider scope); it
 * never creates, logs in or administers them — that is the identity provider's (courthive-hiveid).
 */
@Injectable()
export class UsersService {
  constructor(@Inject(USER_STORAGE) private readonly userStorage: IUserStorage) {}

  async findOne(email: string) {
    return await this.userStorage.findOne(email?.toLowerCase().trim());
  }
}
