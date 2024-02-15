import crypto from 'crypto';

export function createUniqueKey(byteLength = 16) {
  return crypto.randomBytes(byteLength).toString('hex');
}
