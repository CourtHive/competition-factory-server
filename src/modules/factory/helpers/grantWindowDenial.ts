/**
 * The denial a subject sees when every grant they hold on a tournament is
 * outside its window.
 *
 * ## Why this case deserves its own sentence
 *
 * `checkGrantScope` denies EVERY mutation when no grant is live — not merely
 * the ones outside the granted scope. That is deliberate and stays: a grant
 * never confers access (`canMutateTournament` runs first), so treating a lapsed
 * grant as inert would silently widen a shift worker back to whatever their
 * assignment allows, at midnight, with nothing in any log. A loud lockout is the
 * survivable failure; a silent widening is not.
 *
 * But "Not authorized for this time window" tells the person nothing they can
 * act on. It reads as a bug, and it costs a support call during an event —
 * exactly when nobody has time. Naming the instant turns it into a request the
 * subject can make of an administrator themselves.
 *
 * Instants are ISO/UTC because the server does not know the viewer's timezone;
 * the client formats.
 */
type WindowedGrant = { notBefore?: string | Date | null; notAfter?: string | Date | null };

const GENERIC = 'Not authorized for this time window';

function instant(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * Assumes every grant passed is already known to be outside its window — the
 * caller has filtered. Reports the SOONEST future start when one exists, because
 * "wait until 08:00" is actionable, and otherwise the LATEST expiry, which is the
 * moment the subject actually lost access.
 */
export function windowDenialReason(grants: WindowedGrant[], now: Date = new Date()): string {
  const nowMs = now.getTime();

  const upcomingStarts = grants
    .map((grant) => instant(grant.notBefore))
    .filter((ms): ms is number => ms !== null && ms > nowMs);

  if (upcomingStarts.length) {
    return `Your scoped access to this tournament starts at ${iso(Math.min(...upcomingStarts))}`;
  }

  const pastExpiries = grants
    .map((grant) => instant(grant.notAfter))
    .filter((ms): ms is number => ms !== null && ms <= nowMs);

  if (pastExpiries.length) {
    return (
      `Your scoped access to this tournament ended at ${iso(Math.max(...pastExpiries))}` +
      ' — ask an administrator to extend or remove the expired grant'
    );
  }

  // No parseable window on any grant. Unreachable via `isWithinWindow`, which
  // only refuses on a window it could read — but a caller that filtered
  // differently must still get a sentence rather than `undefined`.
  return GENERIC;
}
