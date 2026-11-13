import { ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

/**
 * Replace a client-asserted OPERATOR identity with the one the server authenticated.
 *
 * A presence attestation (factory 7.0.0) can name who vouched for it. When that attester is the desk
 * operator it arrives as `{ attributionType: 'USER', userId, email }` — and a client asserting its own
 * operator identity is unverifiable: TMX sends whatever its token decodes to, and nothing stops a
 * caller sending somebody else's. The server holds the JWT, so the server decides.
 *
 * This is the same principle `tmx.gateway` already applies to `payload.userId`, whose comment reads
 * "a client-supplied string must never survive into attribution". This extends it from the audit row
 * to the attestation itself.
 *
 * ── What is NOT touched, and why it matters ──
 *
 * Only `attributionType: 'USER'` is an identity claim about the REQUESTER. `PARTICIPANT`, `PERSON`
 * and `DECLARED` are recorded statements about somebody else — a parent who presented a junior at the
 * desk. The server cannot verify those either, but they are testimony rather than authentication, and
 * overwriting them would destroy the fact the feature exists to capture. They pass through untouched.
 *
 * ── Offline ──
 *
 * The client value is still ACCEPTED rather than refused, because an offline desk has no server to
 * stamp it and local-first is a supported mode. Server present ⇒ the server's identity wins. Server
 * absent ⇒ the client's claim stands, and is known to be the weaker of the two.
 *
 * ⚠️ Known limitation: an attestation recorded offline by one operator and synced later by another is
 * stamped with the SYNCING operator, because that is the only identity the server can prove. The
 * attestation's `occurredAt` still records when it happened; only the attester is re-attributed.
 */

/** The shape `socket.guard` puts on `client.data.user`. */
export type VerifiedUser = {
  displayName?: string;
  userId?: string;
  email?: string;
  sub?: string;
};

const USER_ATTRIBUTION = 'USER';

/**
 * The server's own attester, or `undefined` when the token carries no usable identifier.
 *
 * `userId` is required by the factory's `USER` variant, so a token with no UUID-shaped id yields no
 * attester at all rather than one keyed on an email — the same reasoning the gateway already applies
 * to `audit_log.user_id`, where a non-UUID would either spoof the column or crash the INSERT.
 */
export function operatorAttribution(verifiedUser?: VerifiedUser): Record<string, any> | undefined {
  const userId = verifiedUser?.userId ?? verifiedUser?.sub;
  if (!userId) return undefined;

  const attester: Record<string, any> = { attributionType: USER_ATTRIBUTION, userId };
  if (verifiedUser?.email) attester.email = verifiedUser.email;
  if (verifiedUser?.displayName) attester.displayName = verifiedUser.displayName;
  return attester;
}

/**
 * Rewrite every `USER` attestation in an executionQueue payload to the authenticated operator.
 *
 * Mutates `payload.methods[].params.attributedTo` in place — the gateway already mutates the payload
 * it forwards (`payload.userId`, `payload.userEmail`), and cloning here would silently drop any
 * field a caller added between this and the dispatch.
 *
 * Returns the number of attestations rewritten, so the caller can log a spoofing attempt rather than
 * only correcting it.
 */
export function stampOperatorAttribution(payload: any, verifiedUser?: VerifiedUser): number {
  const methods = payload?.methods;
  if (!Array.isArray(methods)) return 0;

  const attester = operatorAttribution(verifiedUser);
  const settlements = methods.filter((directive) => directive?.method === 'settleRotatingPartnerResult');
  if (settlements.length && (!attester || typeof attester.userId !== 'string' || !attester.userId.trim()))
    throw new ForbiddenException('Authenticated actor required for settlement');
  const recordedAt = new Date().toISOString();
  // Commands are shared with the broadcast payload: edits here deliberately reach every receiver.
  // This marker is server-owned; stampVerifiedIdentity clears any client-supplied value first.

  let rewritten = 0;

  for (const directive of methods) {
    if (directive?.method === 'settleRotatingPartnerResult' && directive.params) {
      if (directive.params.recordedBy !== attester!.userId) rewritten += 1;
      if (directive.params.recordedBy !== attester!.userId || directive.params.recordedAt !== recordedAt)
        payload.serverStamped = true;
      directive.params.recordedBy = attester!.userId;
      directive.params.recordedAt = recordedAt;
    }
    const attributedTo = directive?.params?.attributedTo;
    if (attributedTo?.attributionType !== USER_ATTRIBUTION) continue;

    if (attester) {
      // Count only a genuine substitution: re-stamping a claim that already matches is not a
      // correction and should not read as one in the logs.
      const differs = attributedTo.userId !== attester.userId;
      if (JSON.stringify(attributedTo) !== JSON.stringify(attester)) payload.serverStamped = true;
      directive.params.attributedTo = { ...attester };
      if (differs) rewritten += 1;
    } else {
      // A USER claim the server cannot substantiate is worse than no attester: it would read as
      // authenticated when nothing authenticated it. Recording who was present is unaffected —
      // only the claim about WHO VOUCHED is dropped.
      payload.serverStamped = true;
      delete directive.params.attributedTo;
      rewritten += 1;
    }
  }

  return rewritten;
}

/**
 * Every identity a mutation payload carries, taken from the authenticated user and never from the
 * client: `userEmail` and `userId` for the audit row, and the operator attestations above.
 *
 * One function for both transports. The REST route stamped only the fields its token carried, so a
 * client-supplied `userId` survived into the audit row, and it never re-stamped attestations at
 * all — a caller could post an operator identity that was not its own to `POST /factory`.
 *
 * `userId` is replaced unconditionally: when the token carries no UUID-shaped identifier it becomes
 * `null`, because `audit_log.user_id` is a nullable UUID and a client string there would either
 * spoof the column or crash the INSERT.
 *
 * Returns the number of attestations rewritten (see `stampOperatorAttribution`).
 */
export function stampVerifiedIdentity(payload: any, verifiedUser?: VerifiedUser): number {
  delete payload.serverStamped;
  if (verifiedUser?.email) payload.userEmail = verifiedUser.email;
  payload.userId = verifiedUser?.userId ?? verifiedUser?.sub ?? null;
  const rewritten = stampOperatorAttribution(payload, verifiedUser);
  stampPresenceAttestations(payload);
  return rewritten;
}

// One attestation each: a server-minted `attestationId` is safe. The sign-in batch builds one per participant, so it
// gets the shared `occurredAt` only and the factory mints its ids.
const SINGLE_ATTESTATION_METHODS = new Set([
  'toggleParticipantCheckInState',
  'setParticipantCheckInState',
  'checkInParticipant',
  'checkOutParticipant',
]);
const BATCH_ATTESTATION_METHODS = new Set(['modifyParticipantsSignInStatus']);

/**
 * Fill a presence write's `occurredAt` (and, for a single attestation, its `attestationId`) with the server's values
 * when the client sent none, so every copy of the record holds the same attestation.
 *
 * Left empty, each engine that applies the command mints its own: CFS on write, the sending desk when it applies the
 * acknowledgement, every other desk when it applies the broadcast. Presence folds by latest `occurredAt`, so a desk
 * whose clock runs behind CFS read an older state than the server for the same history (Guidon check-in journey,
 * 2026-11-12: desk B's check-out sorted before the server-stamped check-in it had just refreshed). The stamped
 * methods reach the sender as `appliedMethods` (`serverStamped`) and every other desk on the broadcast.
 *
 * A value the client did send is kept: an offline desk records when the attestation actually happened.
 */
export function stampPresenceAttestations(payload: any, now = new Date().toISOString()): void {
  const methods = payload?.methods;
  if (!Array.isArray(methods)) return;
  for (const directive of methods) {
    const single = SINGLE_ATTESTATION_METHODS.has(directive?.method);
    if (!directive?.params || (!single && !BATCH_ATTESTATION_METHODS.has(directive.method))) continue;
    if (!directive.params.occurredAt) {
      directive.params.occurredAt = now;
      payload.serverStamped = true;
    }
    if (single && !directive.params.attestationId) {
      directive.params.attestationId = randomUUID();
      payload.serverStamped = true;
    }
  }
}
