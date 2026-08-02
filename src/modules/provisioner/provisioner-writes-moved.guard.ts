import { CanActivate, ExecutionContext, GoneException, Injectable } from '@nestjs/common';

// Flag-gated retirement of the CFS provisioner-MANAGEMENT write endpoints after
// the move to AMS (Mentat/planning/PROVISIONER_MOVE_TO_AMS.md). When
// PROVISIONER_WRITES_MOVED is truthy, write methods (POST/PUT/PATCH/DELETE) on the
// guarded provisioner controllers return 410 Gone; GET reads pass through, and the
// mutation-time authz read + `prov_sk_` auth middleware are untouched (they live
// outside these controllers).
//
// Inert by default: with the flag unset, committing/deploying this changes NOTHING
// — CFS keeps serving provisioner writes as a fallback until the flag is set at the
// coordinated CFS deploy (so it can be flipped on only once AMS is proven, and
// flipped back off to roll back).
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class ProvisionerWritesMovedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const moved = /^(1|true|yes)$/i.test(String(process.env.PROVISIONER_WRITES_MOVED ?? ''));
    if (!moved) return true;
    const request = context.switchToHttp().getRequest();
    if (WRITE_METHODS.has(request?.method)) {
      throw new GoneException('provisioner management has moved to AMS (/ams) — this CFS write endpoint is retired');
    }
    return true;
  }
}
