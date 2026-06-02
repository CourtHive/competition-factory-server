import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { AUDIENCE_KEY, AudienceClaim } from '../decorators/audience.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';

const DEFAULT_REQUIRED_AUDIENCES: AudienceClaim[] = ['admin'];

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();

    // If a non-JWT middleware already authenticated this request — either
    // ProvisionerMiddleware (prov_ tokens) or ProviderApiKeyMiddleware
    // (pkey_ tokens) — skip JWT verification.
    if (request.provisioner || request.provider) {
      return true;
    }

    const token = this.extractTokenFromHeader(request);
    if (!token) {
      throw new UnauthorizedException();
    }

    let payload: any;
    try {
      payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET,
      });
    } catch (err: any) {
      const tokenPreview = token ? `"${token.substring(0, 20)}..."` : String(token);
      Logger.warn(`JWT rejected: ${err?.name || 'unknown'} — token: ${tokenPreview}`, 'AuthGuard');
      throw new UnauthorizedException();
    }

    // Audience check. Routes declare what they accept via @Audience(...).
    // Absent decorator → admin-only (legacy default). Legacy tokens with
    // no `aud` claim are treated as 'admin' so existing sessions still
    // work after this refactor.
    const declared = this.reflector.getAllAndOverride<AudienceClaim[]>(AUDIENCE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const required = Array.isArray(declared) ? declared : DEFAULT_REQUIRED_AUDIENCES;
    if (!audienceMatches(payload?.aud, required)) {
      const tokenAud = JSON.stringify(payload?.aud ?? null);
      const requiredAud = JSON.stringify(required);
      const email = payload?.email ?? '<no-email>';
      const route = `${request.method ?? '?'} ${request.url ?? request.originalUrl ?? '?'}`;
      Logger.warn(
        `JWT audience mismatch: ${email} aud=${tokenAud} required=${requiredAud} route=${route}`,
        'AuthGuard',
      );
      throw new UnauthorizedException();
    }

    request['user'] = payload;
    return true;
  }

  private extractTokenFromHeader(request: any): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}

/**
 * Returns true when the token's `aud` claim overlaps the route's required
 * audiences. Token `aud` may be a string, a string array, or absent;
 * absent is treated as `'admin'` for backwards compatibility with tokens
 * minted before this refactor.
 */
export function audienceMatches(tokenAud: unknown, required: AudienceClaim[]): boolean {
  const tokenAuds: string[] = Array.isArray(tokenAud)
    ? tokenAud
    : typeof tokenAud === 'string'
      ? [tokenAud]
      : ['admin'];
  return required.some((req) => tokenAuds.includes(req));
}
