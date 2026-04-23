import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildInviteUrl } from './inviteUser';

describe('buildInviteUrl', () => {
  beforeEach(() => {
    // Reset location to a known state before each test
    Object.defineProperty(globalThis, 'location', {
      value: { origin: 'https://app.courthive.com', pathname: '/admin/' },
      writable: true,
      configurable: true,
    });
  });

  it('builds a correct invite URL from origin and pathname', () => {
    const url = buildInviteUrl('abc123');
    expect(url).toBe('https://app.courthive.com/admin/#/invite/abc123');
  });

  it('strips trailing slash from pathname', () => {
    globalThis.location = { origin: 'https://app.courthive.com', pathname: '/admin/' } as any;
    const url = buildInviteUrl('code-1');
    expect(url).toBe('https://app.courthive.com/admin/#/invite/code-1');
  });

  it('handles root pathname without double slash', () => {
    globalThis.location = { origin: 'https://app.courthive.com', pathname: '/' } as any;
    const url = buildInviteUrl('code-2');
    expect(url).toBe('https://app.courthive.com/#/invite/code-2');
  });

  it('handles pathname without trailing slash', () => {
    globalThis.location = { origin: 'https://localhost:3000', pathname: '/admin' } as any;
    const url = buildInviteUrl('xyz');
    expect(url).toBe('https://localhost:3000/admin/#/invite/xyz');
  });
});
