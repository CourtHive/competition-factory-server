import { individualMergeCapabilities } from './individualMergeCapabilities';
import { describe, expect, it } from 'vitest';

describe('individual participant merge capability advertisement', () => {
  const methods = {
    mergeIndividualParticipants: () => undefined,
    getIndividualParticipantMergePreview: () => undefined,
  };
  const permissions = { mergeIndividualParticipants: 'canDeleteParticipants' };
  it('requires both engine methods and the provider gate', () => {
    expect(individualMergeCapabilities(methods, permissions).individualParticipantMerge).toBe(true);
    expect(individualMergeCapabilities({}, permissions).individualParticipantMerge).toBe(false);
    expect(individualMergeCapabilities(methods, {}).individualParticipantMerge).toBe(false);
    expect(
      individualMergeCapabilities({ mergeIndividualParticipants: methods.mergeIndividualParticipants }, permissions)
        .individualParticipantMerge,
    ).toBe(false);
  });
});
