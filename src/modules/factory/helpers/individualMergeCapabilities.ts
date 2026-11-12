import { MUTATION_PERMISSIONS } from '@courthive/provider-config';
import { participantGovernor } from 'tods-competition-factory';

/** Advertise the feature only when both validation and the provider permission gate are installed. */
export function individualMergeCapabilities(
  governor: Record<string, unknown> = participantGovernor,
  permissions: Readonly<Record<string, string>> = MUTATION_PERMISSIONS,
) {
  return {
    individualParticipantMerge:
      typeof governor.mergeIndividualParticipants === 'function' &&
      typeof governor.getIndividualParticipantMergePreview === 'function' &&
      permissions.mergeIndividualParticipants === 'canDeleteParticipants',
  };
}
