export function generateKeyCode(index = 0) {
  const uidate = new Date();
  uidate.setHours(uidate.getHours() + index);
  return uidate.getTime().toString(36).slice(-6).toUpperCase();
}
