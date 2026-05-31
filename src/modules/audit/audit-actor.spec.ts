import { toActor } from './audit-actor';

describe('toActor', () => {
  it('returns undefined for null / undefined / empty', () => {
    expect(toActor(null)).toBeUndefined();
    expect(toActor(undefined)).toBeUndefined();
    expect(toActor('')).toBeUndefined();
    expect(toActor({})).toBeUndefined();
  });

  it('recognises a bare uuid string as a user actor', () => {
    expect(toActor('8d3c8b5e-c68d-42ff-9586-03860f667620')).toEqual({
      kind: 'user',
      id: '8d3c8b5e-c68d-42ff-9586-03860f667620',
    });
  });

  it('parses prefixed identifiers', () => {
    expect(toActor('provisioner:e5c4c859-a7e5-4da6-b640-a5fb124c876d')).toEqual({
      kind: 'provisioner',
      id: 'e5c4c859-a7e5-4da6-b640-a5fb124c876d',
    });
    expect(toActor('provider:4b0bd602-fa9b-4fcd-88d9-ff2bf4c5e01c')).toEqual({
      kind: 'provider',
      id: '4b0bd602-fa9b-4fcd-88d9-ff2bf4c5e01c',
    });
    expect(toActor('service:score-relay')).toEqual({ kind: 'service', id: 'score-relay' });
  });

  it('prefers explicit provisionerId on an object input', () => {
    expect(
      toActor({
        userId: 'provider:should-not-win',
        provisionerId: 'e5c4c859-a7e5-4da6-b640-a5fb124c876d',
      }),
    ).toEqual({ kind: 'provisioner', id: 'e5c4c859-a7e5-4da6-b640-a5fb124c876d' });
  });

  it('prefers providerId when provisionerId is absent', () => {
    expect(
      toActor({ userId: 'unrelated', providerId: '4b0bd602-fa9b-4fcd-88d9-ff2bf4c5e01c' }),
    ).toEqual({ kind: 'provider', id: '4b0bd602-fa9b-4fcd-88d9-ff2bf4c5e01c' });
  });

  it('falls through to the userId-as-string path', () => {
    expect(toActor({ userId: 'provisioner:abc-1234-5678-9abc-def012345678' })).toEqual({
      kind: 'provisioner',
      id: 'abc-1234-5678-9abc-def012345678',
    });
  });

  it('returns undefined when nothing resolves', () => {
    expect(toActor({ userId: 'not-a-uuid-or-prefixed' })).toBeUndefined();
    expect(toActor('not-a-uuid-or-prefixed')).toBeUndefined();
  });
});
