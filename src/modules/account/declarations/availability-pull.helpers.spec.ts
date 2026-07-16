import { buildAvailabilityMethods, enumerateDates, extractCanonicalPersonIds } from './availability-pull.helpers';
import { CANONICAL_PERSON } from '../auth/hiveid.constants';

describe('enumerateDates', () => {
  it('lists inclusive calendar days', () => {
    expect(enumerateDates('2026-08-10', '2026-08-12')).toEqual(['2026-08-10', '2026-08-11', '2026-08-12']);
  });

  it('returns a single day when start === end', () => {
    expect(enumerateDates('2026-08-10', '2026-08-10')).toEqual(['2026-08-10']);
  });

  it('returns [] for missing, reversed, or invalid ranges', () => {
    expect(enumerateDates(undefined, '2026-08-12')).toEqual([]);
    expect(enumerateDates('2026-08-12', '2026-08-10')).toEqual([]);
    expect(enumerateDates('nope', '2026-08-12')).toEqual([]);
  });
});

describe('extractCanonicalPersonIds', () => {
  it('collects distinct CANONICAL_PERSON personIds from participants', () => {
    const record = {
      participants: [
        { person: { personOtherIds: [{ organisationId: CANONICAL_PERSON, personId: 'p1' }] } },
        { person: { personOtherIds: [{ organisationId: 'OTHER', personId: 'x' }] } },
        { person: { personOtherIds: [{ organisationId: CANONICAL_PERSON, personId: 'p2' }] } },
        { person: { personOtherIds: [{ organisationId: CANONICAL_PERSON, personId: 'p1' }] } }, // dup
      ],
    };
    expect(extractCanonicalPersonIds(record).sort()).toEqual(['p1', 'p2']);
  });

  it('is defensive against missing participants / personOtherIds', () => {
    expect(extractCanonicalPersonIds({})).toEqual([]);
    expect(extractCanonicalPersonIds({ participants: [{ person: {} }] })).toEqual([]);
  });
});

describe('buildAvailabilityMethods', () => {
  const dates = ['2026-08-10', '2026-08-11', '2026-08-12'];

  it('emits addPersonRequests for UNAVAILABLE days and collects IF_NEEDED as advisory', () => {
    const snapshots = [
      { personId: 'p1', payload: { span: { from: '2026-08-10', to: '2026-08-12' }, days: { '2026-08-11': 'UNAVAILABLE' } } },
      { personId: 'p2', payload: { span: { from: '2026-08-10', to: '2026-08-12' }, days: { '2026-08-12': 'IF_NEEDED' } } },
      { personId: 'p3', payload: { span: { from: '2026-08-10', to: '2026-08-12' }, days: { '2026-08-10': 'AVAILABLE' } } },
    ];
    const { methods, summary } = buildAvailabilityMethods({ snapshots, dates });

    expect(methods).toEqual([
      {
        method: 'addPersonRequests',
        params: {
          personId: 'p1',
          requests: [{ date: '2026-08-11', startTime: '00:00', endTime: '23:59', requestType: 'DO_NOT_SCHEDULE' }],
        },
      },
    ]);
    expect(summary).toEqual({ personsWithRequests: 1, requestsAdded: 1, ifNeeded: { p2: ['2026-08-12'] } });
  });

  it('produces no methods when nobody is UNAVAILABLE', () => {
    const snapshots = [{ personId: 'p1', payload: { span: { from: '2026-08-10', to: '2026-08-12' }, days: {} } }];
    const { methods, summary } = buildAvailabilityMethods({ snapshots, dates });
    expect(methods).toEqual([]);
    expect(summary.personsWithRequests).toBe(0);
  });
});
