import { windowDenialReason } from './grantWindowDenial';

const NOW = new Date('2026-08-24T12:00:00Z');

describe('windowDenialReason', () => {
  // The moment access was actually lost is the one an administrator needs in
  // order to decide whether to extend or revoke.
  it('names when access ended, and what to ask for', () => {
    const reason = windowDenialReason([{ notAfter: '2026-08-23T18:00:00Z' }], NOW);
    expect(reason).toContain('ended at 2026-08-23T18:00:00.000Z');
    expect(reason).toContain('extend or remove');
  });

  it('reports the LATEST expiry when several grants have lapsed', () => {
    const reason = windowDenialReason(
      [
        { notAfter: '2026-08-20T10:00:00Z' },
        { notAfter: '2026-08-23T18:00:00Z' },
        { notAfter: '2026-08-21T09:00:00Z' },
      ],
      NOW,
    );
    expect(reason).toContain('2026-08-23T18:00:00.000Z');
  });

  // "Wait until 08:00" is actionable in a way "you expired" is not, so a future
  // start outranks a past expiry.
  it('reports an upcoming start in preference to a past expiry', () => {
    const reason = windowDenialReason(
      [{ notAfter: '2026-08-23T18:00:00Z' }, { notBefore: '2026-08-25T08:00:00Z' }],
      NOW,
    );
    expect(reason).toContain('starts at 2026-08-25T08:00:00.000Z');
    expect(reason).not.toContain('ended');
  });

  it('reports the SOONEST upcoming start', () => {
    const reason = windowDenialReason(
      [{ notBefore: '2026-08-30T08:00:00Z' }, { notBefore: '2026-08-25T08:00:00Z' }],
      NOW,
    );
    expect(reason).toContain('2026-08-25T08:00:00.000Z');
  });

  it('falls back to the generic sentence when no window can be read', () => {
    expect(windowDenialReason([{}], NOW)).toBe('Not authorized for this time window');
    expect(windowDenialReason([{ notAfter: 'saturday' }], NOW)).toBe('Not authorized for this time window');
    expect(windowDenialReason([], NOW)).toBe('Not authorized for this time window');
  });

  it('accepts Date instances as well as ISO strings', () => {
    expect(windowDenialReason([{ notAfter: new Date('2026-08-23T18:00:00Z') }], NOW)).toContain(
      '2026-08-23T18:00:00.000Z',
    );
  });
});
