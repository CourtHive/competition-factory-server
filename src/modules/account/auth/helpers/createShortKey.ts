export function createShortKey() {
  const uidate = Date.now();
  return uidate.toString(36).slice(-6).toUpperCase();
}
