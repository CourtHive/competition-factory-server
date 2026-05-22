import { Inject, Injectable, NestMiddleware } from '@nestjs/common';

import {
  USER_PROVIDER_STORAGE,
  USER_PROVISIONER_STORAGE,
  PROVISIONER_PROVIDER_STORAGE,
  type IUserProviderStorage,
  type IUserProvisionerStorage,
  type IProvisionerProviderStorage,
} from 'src/storage/interfaces';
import { buildUserContext } from './helpers/buildUserContext';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    @Inject(USER_PROVIDER_STORAGE) private readonly userProviderStorage: IUserProviderStorage,
    @Inject(USER_PROVISIONER_STORAGE) private readonly userProvisionerStorage: IUserProvisionerStorage,
    @Inject(PROVISIONER_PROVIDER_STORAGE)
    private readonly provisionerProviderStorage: IProvisionerProviderStorage,
  ) {}

  async use(req, _res, next: () => void): Promise<void> {
    let jwtPayload;

    if (req.baseUrl === '') {
      next();
      return;
    }
    if (req.headers.authorization) {
      const parts = req.headers.authorization.split(' ');
      if (parts[1]) {
        try {
          jwtPayload = await this.authService.decode(parts[1]);
        } catch {
          // Invalid/expired token — AuthGuard will handle the 401 response.
          // No need to log here; this is expected for stale client tokens.
        }
      }
    }

    // Limited-purpose tokens (e.g. first-login-password-change) carry a
    // `purpose` claim and must not authenticate normal endpoints. They are
    // verified by the endpoint that issued them (currently
    // /auth/complete-first-login) using a body-field token, not Authorization.
    if (jwtPayload?.email != null && !jwtPayload?.purpose) {
      const user = await this.usersService.findOne(jwtPayload.email);
      req.user = user;

      // Hydrate the multi-provider UserContext from user_providers.
      // This runs on every authenticated request so role changes take
      // effect immediately without forced re-login.
      if (user) {
        req.userContext = await buildUserContext(user, {
          userProviderStorage: this.userProviderStorage,
          userProvisionerStorage: this.userProvisionerStorage,
          provisionerProviderStorage: this.provisionerProviderStorage,
        });
      }
    }

    next();
  }
}
