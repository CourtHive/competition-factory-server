import { withoutRecoveryData } from './withoutRecoveryData';
import { describe, expect, it } from 'vitest';

describe('withoutRecoveryData', () => {
  it('drops merge recovery snapshots from method results and keeps everything else', () => {
    const input = {
      success: true,
      commandId: 'c1',
      results: [
        {
          methodName: 'mergeIndividualParticipants',
          success: true,
          changedPaths: ['/x'],
          mergeReceipt: { before: {} },
        },
        { methodName: 'addParticipants', success: true },
        null,
      ],
    };
    const output = withoutRecoveryData(input);
    expect(output.results).toEqual([
      { methodName: 'mergeIndividualParticipants', success: true, changedPaths: ['/x'] },
      { methodName: 'addParticipants', success: true },
      null,
    ]);
    expect(output.commandId).toBe('c1');
    // The receipt row is written from the original result, so it must be left intact.
    expect(input.results[0]).toHaveProperty('mergeReceipt');
  });

  it('passes through results without a method list', () => {
    const refusal = { error: 'No tournamentIds provided' };
    expect(withoutRecoveryData(refusal)).toBe(refusal);
  });
});
