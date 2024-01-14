import { CanActivate, Injectable, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { Roles } from '../decorators/roles.decorator';
import { Reflector } from '@nestjs/core';
import { Socket } from 'socket.io';

@Injectable()
export class SocketGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const socket: Socket = context.switchToWs().getClient();
    const token = this.extractTokenFromContext(context);
    if (!token) {
      socket.emit('exception', { message: 'Not logged in or token expired' });
      return false;
    }

    try {
      const user = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET,
      });
      return new Promise((resolve, reject) => {
        const roles = this.reflector.get(Roles, context.getHandler());
        const hasRole = !roles || user.roles?.some((role) => !!roles.find((item) => item === role));
        return hasRole ? resolve(true) : reject(false);
      });
    } catch (exception) {
      socket.emit('exception', { message: exception });
      return false;
    }
  }

  private extractTokenFromContext(context: any): string | undefined {
    const [type, token] = context.args[0].handshake.headers.authorization?.split(' ') ?? '';
    return type === 'Bearer' ? token : undefined;
  }
}
