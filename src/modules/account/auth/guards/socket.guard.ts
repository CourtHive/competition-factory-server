import { CanActivate, Injectable, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { AUDIENCE_KEY, AudienceClaim } from '../decorators/audience.decorator';
import { extractHandshakeToken } from 'src/common/auth/extractHandshakeToken';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { verifyJwt } from 'src/common/auth/verifyJwt';
import { Roles } from '../decorators/roles.decorator';
import { audienceMatches } from './auth.guard';
import { Reflector } from '@nestjs/core';
import { Socket } from 'socket.io';

const DEFAULT_REQUIRED_AUDIENCES: AudienceClaim[] = ['admin'];

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

    const client: Socket = context.switchToWs().getClient();
    const token = extractHandshakeToken(client.handshake);

    if (!token) {
      client.emit('exception', { message: 'Not logged in or token expired' });
      return false;
    }

    try {
      const user = await verifyJwt(this.jwtService, token);

      // Audience check. Gateways declare the audience they accept via
      // @Audience([...]) at class or method level. Absent decorator =
      // admin-only (legacy default — matches AuthGuard). Tokens with no
      // `aud` claim are treated as admin so existing TMX sessions keep
      // working after the audience refactor.
      const declared = this.reflector.getAllAndOverride<AudienceClaim[]>(AUDIENCE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      const required = Array.isArray(declared) ? declared : DEFAULT_REQUIRED_AUDIENCES;
      if (!audienceMatches(user?.aud, required)) {
        client.emit('exception', { message: 'Token audience not accepted on this namespace' });
        return false;
      }

      return new Promise((resolve, reject) => {
        const roles = this.reflector.get(Roles, context.getHandler());
        const hasRole = !roles || !!user.roles?.find((role) => !!roles.find((item) => item === role));
        context.switchToHttp().getRequest().user = user;
        // Also store on the socket's data so gateway handlers can access the
        // verified user identity without reaching into the HTTP context.
        client.data.user = user;
        return hasRole ? resolve(true) : reject(new Error('Unauthorized access'));
      });
    } catch (exception) {
      client.emit('exception', { message: exception });
      return false;
    }
  }
}
