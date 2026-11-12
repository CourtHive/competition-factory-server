import { withoutReportedNoOps } from './presenceNoOps';

const intention = (checkedIn: boolean) => ({
  method: 'setParticipantCheckInState',
  params: { checkedIn, participantId: 'p1', matchUpId: 'm1', drawId: 'd1' },
});

describe('withoutReportedNoOps', () => {
  it('drops an intention whose result reports nothing changed and keeps one that did', () => {
    const methods = [intention(true), intention(true)];
    const results = [
      { success: true, changed: true, methodName: 'setParticipantCheckInState' },
      { success: true, changed: false, methodName: 'setParticipantCheckInState' },
    ];

    const applied = withoutReportedNoOps(methods, results);
    expect(applied.methods).toEqual([methods[0]]);
    expect(applied.dropped).toEqual(1);
  });

  it('never filters a method outside the reporting set, whatever its result says', () => {
    const methods = [{ method: 'setMatchUpStatus', params: {} }];
    const applied = withoutReportedNoOps(methods, [{ success: true, changed: false, methodName: 'setMatchUpStatus' }]);
    expect(applied).toEqual({ methods, dropped: 0 });
  });

  // A copy that misses a real change is caught by the staleness probe; a replayed no-op is caught by nothing.
  it('drops an intention whose result is missing or belongs to another method', () => {
    const methods = [intention(true), intention(false)];
    expect(withoutReportedNoOps(methods, undefined).methods).toEqual([]);
    expect(
      withoutReportedNoOps(methods, [
        { success: true, changed: true, methodName: 'checkInParticipant' },
        { success: true, methodName: 'setParticipantCheckInState' },
      ]).methods,
    ).toEqual([]);
  });

  it('keeps the order of the methods that remain', () => {
    const other = { method: 'addEventEntries', params: {} };
    const methods = [other, intention(true), intention(false)];
    const results = [
      { success: true, methodName: 'addEventEntries' },
      { success: true, changed: false, methodName: 'setParticipantCheckInState' },
      { success: true, changed: true, methodName: 'setParticipantCheckInState' },
    ];
    expect(withoutReportedNoOps(methods, results).methods).toEqual([other, methods[2]]);
  });
});
