import { Injectable, NestMiddleware } from '@nestjs/common';

import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(
    private readonly authService: AuthService,
    private usersService: UsersService,
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
        } catch {}
      }
    }

    if (jwtPayload?.email != null) {
      req.user = await this.usersService.findOne(jwtPayload.email);
    }

    next();
  }
}
