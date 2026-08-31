import type { ParticipationRow } from 'src/storage/interfaces/participation-storage.interface';

/**
 * Derive the participation rows a tournament asserts.
 *
 * SUBJECT IDENTITY COMES FROM `participantOtherIds`, NEVER FROM `participantId`. A participantId is
 * tournament-local: the same programme carries a different one in every record it appears in, so
 * indexing on it would give each team a season of exactly one fixture — plausible-looking and
 * wrong. `participantOtherIds` is the field CODES documents for this ("entry per organisation …
 * this works for PAIR and TEAM"), and it carries the issuing organisation's own id, which is stable
 * across records by construction.
 *
 * A TEAM participant with no `participantOtherIds` contributes NO row. That is a recorded gap — the
 * record does not state a durable identity for that competitor — and inventing one from the local
 * participantId would manufacture exactly the wrong answer described above.
 */
export function deriveParticipationRows(tournamentRecord: any): ParticipationRow[] {
  const participants: any[] = tournamentRecord?.participants ?? [];
  const providerId = tournamentRecord?.parentOrganisation?.organisationId;
  const tournamentId = tournamentRecord?.tournamentId;
  if (!tournamentId) return [];

  const shared = {
    providerId,
    tournamentName: tournamentRecord?.tournamentName,
    startDate: tournamentRecord?.startDate,
    endDate: tournamentRecord?.endDate,
    eventCount: (tournamentRecord?.events ?? []).length,
  };

  const rows: ParticipationRow[] = [];
  const seen = new Set<string>();

  for (const participant of participants) {
    if (participant?.participantType !== 'TEAM') continue;
    for (const otherId of participant?.participantOtherIds ?? []) {
      const subjectId = otherId?.participantId;
      if (!subjectId) continue;
      // One row per (subject, participant): a team entered twice under the same issued id is one
      // participation, and the primary key would reject the duplicate anyway.
      const key = `${subjectId}|${participant.participantId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        subjectType: 'TEAM',
        subjectId,
        tournamentId,
        participantId: participant.participantId,
        ...shared,
      });
    }
  }

  return rows;
}
