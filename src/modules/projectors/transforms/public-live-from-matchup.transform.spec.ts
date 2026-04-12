import { buildPublicLivePayloadFromMatchUp } from './public-live-from-matchup.transform';

const buildMatchUp = (overrides: Record<string, any> = {}) => ({
  matchUpId: 'm-1',
  matchUpFormat: 'SET3-S:6/TB7',
  matchUpStatus: 'TO_BE_PLAYED',
  sides: [
    { sideNumber: 1, participant: { participantId: 'p1', participantName: 'Alice' } },
    { sideNumber: 2, participant: { participantId: 'p2', participantName: 'Bob' } },
  ],
  score: { sets: [] },
  ...overrides,
});

describe('buildPublicLivePayloadFromMatchUp', () => {
  it('returns null when matchUpId is missing', () => {
    expect(buildPublicLivePayloadFromMatchUp({ matchUpId: '' }, 'tour-1')).toBeNull();
  });

  it('returns null when tournamentId is missing', () => {
    expect(buildPublicLivePayloadFromMatchUp(buildMatchUp(), '')).toBeNull();
  });

  it('builds a STANDARD payload in pre state when no scores exist', () => {
    const payload = buildPublicLivePayloadFromMatchUp(buildMatchUp(), 'tour-1');
    expect(payload?.format).toBe('STANDARD');
    expect(payload?.status).toBe('pre');
    expect(payload?.side1.setScores).toEqual([]);
    expect(payload?.side2.setScores).toEqual([]);
    expect(payload?.intennseBolt).toBeUndefined();
    expect(payload?.matchUpId).toBe('m-1');
    expect(payload?.tournamentId).toBe('tour-1');
  });

  it('builds an in_progress payload when set scores exist', () => {
    const payload = buildPublicLivePayloadFromMatchUp(
      buildMatchUp({
        score: {
          sets: [
            { side1Score: 6, side2Score: 4 },
            { side1Score: 3, side2Score: 2 },
          ],
        },
      }),
      'tour-1',
    );
    expect(payload?.status).toBe('in_progress');
    expect(payload?.side1.setScores).toEqual([6, 3]);
    expect(payload?.side2.setScores).toEqual([4, 2]);
  });

  it('treats a tiebreak score as in-progress even if regular set score is 0', () => {
    const payload = buildPublicLivePayloadFromMatchUp(
      buildMatchUp({
        score: {
          sets: [{ side1Score: 0, side2Score: 0, side1TiebreakScore: 5, side2TiebreakScore: 3 }],
        },
      }),
      'tour-1',
    );
    expect(payload?.status).toBe('in_progress');
  });

  it('builds a completed payload when winningSide is set', () => {
    const payload = buildPublicLivePayloadFromMatchUp(
      buildMatchUp({
        winningSide: 1,
        score: { sets: [{ side1Score: 6, side2Score: 4 }, { side1Score: 6, side2Score: 3 }] },
      }),
      'tour-1',
    );
    expect(payload?.status).toBe('completed');
  });

  it('builds a completed payload when matchUpStatus is COMPLETED', () => {
    const payload = buildPublicLivePayloadFromMatchUp(
      buildMatchUp({
        matchUpStatus: 'COMPLETED',
      }),
      'tour-1',
    );
    expect(payload?.status).toBe('completed');
  });

  it('emits format INTENNSE when matchUpFormat carries the XA-S:T marker', () => {
    const payload = buildPublicLivePayloadFromMatchUp(
      buildMatchUp({ matchUpFormat: 'SET3-S:T7XA-S:T10P' }),
      'tour-1',
    );
    expect(payload?.format).toBe('INTENNSE');
    // intennseBolt is still undefined because this transform doesn't have
    // the bolt-history clock state — that comes from the bolt-history path
    expect(payload?.intennseBolt).toBeUndefined();
  });

  it('resolves participant names for singles sides', () => {
    const payload = buildPublicLivePayloadFromMatchUp(buildMatchUp(), 'tour-1');
    expect(payload?.side1.playerName).toBe('Alice');
    expect(payload?.side2.playerName).toBe('Bob');
  });

  it('resolves participant names for doubles sides via individualParticipants', () => {
    const payload = buildPublicLivePayloadFromMatchUp(
      buildMatchUp({
        sides: [
          {
            sideNumber: 1,
            participant: {
              individualParticipants: [
                { participantName: 'Alice' },
                { participantName: 'Anna' },
              ],
            },
          },
          {
            sideNumber: 2,
            participant: {
              individualParticipants: [
                { participantName: 'Bob' },
                { participantName: 'Ben' },
              ],
            },
          },
        ],
      }),
      'tour-1',
    );
    expect(payload?.side1.playerName).toBe('Alice / Anna');
    expect(payload?.side2.playerName).toBe('Bob / Ben');
  });

  it('handles missing sides gracefully', () => {
    const payload = buildPublicLivePayloadFromMatchUp(
      { matchUpId: 'm-1', score: { sets: [] } },
      'tour-1',
    );
    expect(payload?.side1.playerName).toBe('');
    expect(payload?.side2.playerName).toBe('');
  });

  it('emits gameScore as undefined and isServing as false (not derivable from stored matchUp)', () => {
    const payload = buildPublicLivePayloadFromMatchUp(buildMatchUp(), 'tour-1');
    expect(payload?.side1.gameScore).toBeUndefined();
    expect(payload?.side1.isServing).toBe(false);
    expect(payload?.side2.gameScore).toBeUndefined();
    expect(payload?.side2.isServing).toBe(false);
  });
});
