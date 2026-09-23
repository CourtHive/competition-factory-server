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
  let rewritten = 0;

  for (const directive of methods) {
    const attributedTo = directive?.params?.attributedTo;
    if (attributedTo?.attributionType !== USER_ATTRIBUTION) continue;

    if (attester) {
      // Count only a genuine substitution: re-stamping a claim that already matches is not a
      // correction and should not read as one in the logs.
      const differs = attributedTo.userId !== attester.userId;
      directive.params.attributedTo = { ...attester };
      if (differs) rewritten += 1;
    } else {
      // A USER claim the server cannot substantiate is worse than no attester: it would read as
      // authenticated when nothing authenticated it. Recording who was present is unaffected —
      // only the claim about WHO VOUCHED is dropped.
      delete directive.params.attributedTo;
      rewritten += 1;
    }
  }

  return rewritten;
}
