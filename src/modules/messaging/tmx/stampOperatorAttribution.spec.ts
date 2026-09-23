import { operatorAttribution, stampOperatorAttribution } from './stampOperatorAttribution';

const VERIFIED = { userId: 'uuid-real', email: 'desk@example.com', displayName: 'Desk One' };

function payloadWith(attributedTo?: any, method = 'toggleParticipantCheckInState') {
  return { methods: [{ method, params: { matchUpId: 'm1', drawId: 'd1', participantId: 'p1', attributedTo } }] };
}

const attesterOf = (payload: any) => payload.methods[0].params.attributedTo;

describe('operatorAttribution', () => {
  it('builds a USER attester from the verified identity', () => {
    expect(operatorAttribution(VERIFIED)).toEqual({
      attributionType: 'USER',
      userId: 'uuid-real',
      email: 'desk@example.com',
      displayName: 'Desk One',
    });
  });

  it('falls back to `sub` when the token uses that claim', () => {
    expect(operatorAttribution({ sub: 'uuid-sub' })).toMatchObject({ userId: 'uuid-sub' });
  });

  it('yields NOTHING when the token carries no usable id', () => {
    // `userId` is required by the factory's USER variant; keying on an email would conflate an
    // auth identity with a CODES person, which is the mistake `personnelRules.roleName` already made
    expect(operatorAttribution({ email: 'desk@example.com' })).toBeUndefined();
    expect(operatorAttribution(undefined)).toBeUndefined();
  });
});

describe('stampOperatorAttribution', () => {
  it('overwrites an operator identity the client asserted for somebody else', () => {
    const payload = payloadWith({ attributionType: 'USER', userId: 'uuid-SOMEONE-ELSE' });

    const rewritten = stampOperatorAttribution(payload, VERIFIED);

    expect(attesterOf(payload).userId).toEqual('uuid-real');
    expect(rewritten).toEqual(1);
  });

  it('does not count a claim that already matches as a correction', () => {
    const payload = payloadWith({ attributionType: 'USER', userId: 'uuid-real' });

    // re-stamping an honest claim is not a spoofing attempt and must not read as one in the logs
    expect(stampOperatorAttribution(payload, VERIFIED)).toEqual(0);
    expect(attesterOf(payload).userId).toEqual('uuid-real');
  });

  it('DROPS a USER claim the server cannot substantiate', () => {
    const payload = payloadWith({ attributionType: 'USER', userId: 'uuid-claimed' });

    const rewritten = stampOperatorAttribution(payload, { email: 'no-uuid@example.com' });

    // an unverifiable claim that reads as authenticated is worse than no attester at all
    expect(attesterOf(payload)).toBeUndefined();
    expect(rewritten).toEqual(1);
  });

  it('leaves a DECLARED attester alone — it is testimony, not authentication', () => {
    const parent = { attributionType: 'DECLARED', relationship: 'PARENT', name: 'A. Guardian' };
    const payload = payloadWith({ ...parent });

    const rewritten = stampOperatorAttribution(payload, VERIFIED);

    // the whole point of the feature: somebody who is NOT in the record vouched for a junior
    expect(attesterOf(payload)).toEqual(parent);
    expect(rewritten).toEqual(0);
  });

  it('leaves PARTICIPANT and PERSON attesters alone', () => {
    for (const attributedTo of [
      { attributionType: 'PARTICIPANT', participantId: 'p1', relationship: 'SELF' },
      { attributionType: 'PERSON', personId: 'person-1' },
    ]) {
      const payload = payloadWith({ ...attributedTo });
      expect(stampOperatorAttribution(payload, VERIFIED)).toEqual(0);
      expect(attesterOf(payload)).toEqual(attributedTo);
    }
  });

  it('adds no attester where the client sent none', () => {
    const payload = payloadWith(undefined);

    stampOperatorAttribution(payload, VERIFIED);

    // an un-attributed check-in records no attester; inventing one would make every desk action
    // look deliberately attested when nobody stated anything
    expect(attesterOf(payload)).toBeUndefined();
  });

  it('rewrites every method in a batch, not just the first', () => {
    const payload = {
      methods: [
        { method: 'checkInParticipant', params: { attributedTo: { attributionType: 'USER', userId: 'x' } } },
        {
          method: 'modifyParticipantsSignInStatus',
          params: { attributedTo: { attributionType: 'USER', userId: 'y' } },
        },
        { method: 'addEvent', params: {} },
      ],
    };

    expect(stampOperatorAttribution(payload, VERIFIED)).toEqual(2);
    expect(payload.methods[0].params.attributedTo).toMatchObject({ userId: 'uuid-real' });
    expect(payload.methods[1].params.attributedTo).toMatchObject({ userId: 'uuid-real' });
    expect(payload.methods[2].params).toEqual({});
  });

  it('gives each method its own attester object', () => {
    const payload = {
      methods: [
        { method: 'a', params: { attributedTo: { attributionType: 'USER', userId: 'x' } } },
        { method: 'b', params: { attributedTo: { attributionType: 'USER', userId: 'y' } } },
      ],
    };

    stampOperatorAttribution(payload, VERIFIED);

    // a shared reference would let one method's later mutation rewrite another's stored attestation
    expect(payload.methods[0].params.attributedTo).not.toBe(payload.methods[1].params.attributedTo);
  });

  it('tolerates a payload with no methods', () => {
    expect(stampOperatorAttribution({}, VERIFIED)).toEqual(0);
    expect(stampOperatorAttribution({ methods: null }, VERIFIED)).toEqual(0);
    expect(stampOperatorAttribution(undefined, VERIFIED)).toEqual(0);
  });
});
