//import { UsersService } from 'src/providers/users/users.service';
import { CanActivate, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { Reflector } from '@nestjs/core';

@Injectable()
export class SocketGuard implements CanActivate {
  constructor(
    // private userService: UsersService,
    private jwtService: JwtService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: any): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const token = this.extractTokenFromContext(context);
    if (!token) return false;
    console.log({ token });

    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET,
      });
      return new Promise((resolve, reject) => {
        console.log({ payload });
        return payload ? resolve(true) : reject(false);
        /*
        return this.userService.findOne(decoded.username).then((user) => {
          if (user) {
            resolve(user);
          } else {
            reject(false);
          }
        });
	*/
      });
    } catch (exception) {
      console.log(exception);
      return false;
    }
  }

  private extractTokenFromContext(context: any): string | undefined {
    const [type, token] = context.args[0].handshake.headers.authorization?.split(' ') ?? '';
    return type === 'Bearer' ? token : undefined;
  }
}
