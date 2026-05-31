import type { AuditActor } from 'src/storage/interfaces/audit-storage.interface';

/**
 * Resolve the polymorphic AuditActor from whatever caller-identity shape
 * the various middlewares synthesise into req.user.
 *
 * Recognised inputs:
 *
 *   • `provider:<uuid>`            → { kind: 'provider',    id: <uuid> }
 *   • `provisioner:<uuid>`         → { kind: 'provisioner', id: <uuid> }
 *   • `service:<name>`             → { kind: 'service',     id: <name> }
 *   • bare uuid                    → { kind: 'user',        id: <uuid> }
 *   • anything else                → undefined (fail-open; the audit
 *                                              row still lands without
 *                                              an actor, so logs stay
 *                                              clean and the source
 *                                              column carries the
 *                                              fallback).
 *
 * Convenience overloads accept either a string (the userId straight
 * out of req.user.userId) or an object whose userId / providerId /
 * provisionerId fields hint the shape.
 */
export function toActor(
  user: { userId?: string; providerId?: string; provisionerId?: string } | string | undefined | null,
): AuditActor | undefined {
  if (!user) return undefined;

  if (typeof user === 'string') {
    return fromIdentifier(user);
  }

  if (user.provisionerId) return { kind: 'provisioner', id: user.provisionerId };
  if (user.providerId) return { kind: 'provider', id: user.providerId };
  if (user.userId) return fromIdentifier(user.userId);

  return undefined;
}

function fromIdentifier(id: string): AuditActor | undefined {
  if (id.startsWith('provisioner:')) return { kind: 'provisioner', id: id.slice('provisioner:'.length) };
  if (id.startsWith('provider:')) return { kind: 'provider', id: id.slice('provider:'.length) };
  if (id.startsWith('service:')) return { kind: 'service', id: id.slice('service:'.length) };
  if (isUuid(id)) return { kind: 'user', id };
  return undefined;
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
