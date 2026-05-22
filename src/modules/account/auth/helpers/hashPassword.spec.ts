import { hashPassword } from './hashPassword';
import bcrypt from 'bcryptjs';

describe('hashPassword', () => {
  it('returns a bcrypt hash', async () => {
    const hash = await hashPassword('mypassword');
    expect(hash).toBeDefined();
    expect(typeof hash).toBe('string');
    // bcrypt hashes start with $2a$ or $2b$
    expect(hash).toMatch(/^\$2[ab]\$/);
  });

  it('produces a hash that validates against the original password', async () => {
    const password = 'test-password-123';
    const hash = await hashPassword(password);
    const isMatch = await bcrypt.compare(password, hash);
    expect(isMatch).toBe(true);
  });

  it('does not match a different password', async () => {
    const hash = await hashPassword('correct-password');
    const isMatch = await bcrypt.compare('wrong-password', hash);
    expect(isMatch).toBe(false);
  });

  it('produces different hashes for the same password (salt)', async () => {
    const hash1 = await hashPassword('same-password');
    const hash2 = await hashPassword('same-password');
    expect(hash1).not.toBe(hash2);
    // But both should validate
    expect(await bcrypt.compare('same-password', hash1)).toBe(true);
    expect(await bcrypt.compare('same-password', hash2)).toBe(true);
  });
});
