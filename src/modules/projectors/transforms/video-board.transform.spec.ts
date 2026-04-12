import { buildVideoBoardPayload } from './video-board.transform';
import {
  buildCompleteBoltHistory,
  buildMidBoltHistory,
  buildSampleBoltHistory,
} from '../fixtures/sample-bolt-history';

describe('video-board.transform', () => {
  it('builds a pre-bolt payload with stopped clocks', () => {
    const payload = buildVideoBoardPayload(buildSampleBoltHistory(), 1);
    expect(payload.matchUpId).toBe('tie-sample-1');
    expect(payload.bolt.state).toBe('pre');
    expect(payload.bolt.boltClock.running).toBe(false);
    expect(payload.bolt.serveClock.running).toBe(false);
    expect(payload.bolt.boltClock.remainingMs).toBe(600000);
    expect(payload.sequence).toBe(1);
  });

  it('builds a mid-bolt payload with running clocks', () => {
    const payload = buildVideoBoardPayload(buildMidBoltHistory(), 7);
    expect(payload.bolt.state).toBe('play');
    expect(payload.bolt.boltClock.running).toBe(true);
    expect(payload.bolt.serveClock.running).toBe(true);
    expect(payload.scoreboard.side1.boltScore).toBe(5);
    expect(payload.scoreboard.side1.isServing).toBe(true);
    expect(payload.scoreboard.side2.isServing).toBe(false);
    expect(payload.sequence).toBe(7);
  });

  it('builds a complete payload with stopped clocks', () => {
    const payload = buildVideoBoardPayload(buildCompleteBoltHistory(), 99);
    expect(payload.bolt.state).toBe('complete');
    expect(payload.bolt.boltClock.running).toBe(false);
    expect(payload.bolt.serveClock.running).toBe(false);
    expect(payload.scoreboard.side1.boltScore).toBe(21);
    expect(payload.scoreboard.side2.boltScore).toBe(18);
    expect(payload.sequence).toBe(99);
  });

  it('emits matching anchor timestamps for both clocks', () => {
    const payload = buildVideoBoardPayload(buildMidBoltHistory(), 1);
    expect(payload.bolt.boltClock.anchorTimestamp).toBe(payload.bolt.serveClock.anchorTimestamp);
    expect(payload.bolt.boltClock.anchorTimestamp).toBe(payload.generatedAt);
  });
});
