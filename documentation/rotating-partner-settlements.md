# Rotating-partner settlement audit

## Execution boundary

POST /factory already verifies mutation authorization and stamps the request identity.
`executionQueue` stamps settleRotatingPartnerResult actor/time inside the tournament lock,
after fetching the current records and before invoking the factory. Client-asserted
recordedBy and recordedAt cannot override the authenticated actor or server clock.

An existing requestId reuses its persisted timestamp. The actor always comes from the
current verified request; factory idempotency rejects another operator borrowing an old
requestId. The factory remains responsible for terminal-status eligibility, stale sporting
outcomes, treatment validation, supersession and append-only settlement history.

## Confirmation contract

A successfully persisted settlement batch returns:

- `appliedMethods`: the stamped commands, also carried in the controller's normal broadcast.
- `settlementAudits`: confirmed tournamentId, drawId, requestId, matchUpId, recordedBy and
  recordedAt, read from the final persisted engine state.

Factory refusals and persistence failures return no audit confirmation. Ordinary batches
keep their existing acknowledgement shape. Nothing here requires TMX to wait for the
server when configured local-first: that client reconciles confirmed audit metadata later.

## Verification and rollout

Focused tests cover identity replacement/refusal, retry timestamps, ambiguous draw IDs,
stamping before execution, persistence ordering, ordinary-command compatibility and no
receipts after rejection/failure. Existing affected execution, authorization, locking and
async-isolation suites also run. Types, lint and the Nest build are checked separately.

These changes do not publish or merge the factory. The actual settlement method requires
the upcoming factory release; the current package pin is unchanged. Complete PostgreSQL/
HTTP integration still requires the configured external review environment, and socket
permission failures are not passing gates.
