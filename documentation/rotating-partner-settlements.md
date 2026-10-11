# Rotating-partner settlement audit

## One verified identity boundary

stampVerifiedIdentity / stampOperatorAttribution replaces client identity claims before execution. Settlement recordedBy comes from the authenticated operator and recordedAt from the server clock. A settlement with no usable verified identity is refused. Genuine actor substitutions are counted alongside USER presence-attestation substitutions. Commands are edited in place deliberately: the broadcast shares those command objects and carries their stamped values to other clients.

The server-owned serverStamped marker records changes to any command parameter, including attestation email/name changes. Client-supplied markers are cleared at the boundary. After successful factory execution and persistence, acknowledgements include a detached appliedMethods copy when stamping changed commands. Ordinary batches keep their existing acknowledgement shape. Refusals and persistence failures return no appliedMethods. Settlement receipts have been removed.

## Local-first policy

Server present ⇒ the server’s identity wins. Server absent ⇒ the client’s claim stands.
The syncing operator is the identity the server can verify; the server timestamp is receipt time. TMX server-first replays the canonical commands. Local-first still executes immediately with local claims and does not rewrite records through a settlement-specific reconciliation layer. General convergence of local-first copies is a separate synchronization decision.

## Published dependency and retry sequencing

This branch depends on published factory 7.11.0. That version still compares audit metadata on repeated requestIds. Until a later CA-authorized release carries the factory retry change, preserveSettlementRetryTime retains the prior timestamp inside the tournament lock. It does not stamp identity or create receipts. A different operator retry still conflicts under 7.11.0. Remove this compatibility lookup only in the consumer bump to the release that returns the original settlement regardless of new retry actor/time.

Browser and HTTP/Postgres integration and all gates under published dependency resolution must pass before merge. Linked-source tests alone are insufficient.
