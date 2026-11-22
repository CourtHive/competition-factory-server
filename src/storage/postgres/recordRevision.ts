import { createHash } from 'node:crypto';

// Bound to the exact object read by the full-record SELECT. Never serialized with it.
const revisions = new WeakMap<object, string>();
export function markRecordRevision(record: object, id: string, version?: string) {
  if (version)
    revisions.set(
      record,
      createHash('sha256')
        .update(JSON.stringify([id, version]))
        .digest('base64url'),
    );
}
export function recordRevision(record: object) {
  return revisions.get(record);
}
