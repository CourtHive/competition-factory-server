/**
 * Lightweight "dirty intents" recorded by the getMutationEngine subscription
 * handlers during a mutation. Handlers have NO engine/record reference, so they
 * only note WHAT changed; the post-commit flush in executionQueue.ts turns
 * these into concrete row deltas against the mutation's final state.
 */
export type ProjectionIntent =
  | { kind: 'flattenDraw'; tournamentId: string; drawId: string }
  | { kind: 'matchUpResult'; tournamentId: string; matchUp: any }
  | { kind: 'republishEvent'; tournamentId: string; eventId: string }
  | { kind: 'claimPerson'; tournamentId: string; participantId: string; personId: string }
  // A rename fans out to every competitor row carrying that participant's name.
  // `match_up_competitors.participant_name` is otherwise written ONLY by the
  // draw-scoped flatten, so without this a renamed person stays stale in the read
  // model until something unrelated re-flattens their draw.
  | { kind: 'participantName'; tournamentId: string; participantId: string; participantName: string | null }
  | { kind: 'touchTournament'; tournamentId: string }
  | { kind: 'participants'; tournamentId: string }
  | { kind: 'entries'; tournamentId: string }
  | { kind: 'events'; tournamentId: string }
  | { kind: 'draw'; tournamentId: string; drawId: string }
  | { kind: 'seeds'; tournamentId: string; structureId: string }
  | { kind: 'orderOfPlay'; tournamentId: string }
  | { kind: 'schedulingProfile'; tournamentId: string; schedulingProfile: any[] }
  | { kind: 'participantPublish'; tournamentId: string }
  | { kind: 'venue'; tournamentId: string; venue: any }
  | { kind: 'deleteVenue'; tournamentId: string; venueId: string }
  | { kind: 'deleteDraw'; tournamentId: string; drawId: string }
  | { kind: 'deleteMatchUps'; tournamentId: string; matchUpIds: string[] }
  | { kind: 'deleteEvent'; tournamentId: string; eventId: string }
  | { kind: 'deleteParticipants'; tournamentId: string; participantIds: string[] };

/**
 * Request-scoped buffer threaded into getMutationEngine (like `publicNotices`).
 * Its mere presence enables the producer path; when the feature flag is off no
 * buffer is created and every recorder is a no-op.
 */
export interface DeltaBuffer {
  intents: ProjectionIntent[];
  /** Tournament scope of the owning mutation — used to attribute notices whose
   *  payload omits `tournamentId` (some draw/participant notices do). */
  tournamentIds: string[];
}
