# Rotating-partner settlement audit

## One verified identity boundary

stampVerifiedIdentity / stampOperatorAttribution replaces client identity claims before execution. Settlement recordedBy comes from the authenticated operator and recordedAt from the server clock. A settlement with no usable verified identity is refused. Genuine actor substitutions are counted alongside USER presence-attestation substitutions. Commands are edited in place deliberately: the broadcast shares those command objects and carries their stamped values to other clients.

The server-owned serverStamped marker records changes to any command parameter, including attestation email/name changes. Client-supplied markers are cleared at the boundary. After successful factory execution and persistence, acknowledgements include a detached appliedMethods copy when stamping changed commands. Ordinary batches keep their existing acknowledgement shape. Refusals and persistence failures return no appliedMethods. Settlement receipts have been removed.

## Local-first policy

Server present ⇒ the server’s identity wins. Server absent ⇒ the client’s claim stands.
The syncing operator is the identity the server can verify; the server timestamp is receipt time. TMX server-first replays the canonical commands. Local-first still executes immediately with local claims and does not rewrite records through a settlement-specific reconciliation layer. General convergence of local-first copies is a separate synchronization decision.

## Retries

The factory returns the original settlement for a repeated requestId when its intent matches, ignoring a new
recordedBy/recordedAt (#5382(factory)): the first attribution and time stand, whoever retries. So the server stamps
every request afresh at the identity boundary and does not look up prior settlements. This needs a factory release that
carries #5382(factory); on 7.11.0 a retry stamped with a new time conflicts, which is why 7.11.0 consumers kept a
compatibility lookup (`preserveSettlementRetryTime`, removed here).

Browser and HTTP/Postgres integration and all gates under published dependency resolution must pass before merge. Linked-source tests alone are insufficient.
