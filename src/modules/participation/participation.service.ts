import { Inject, Injectable } from '@nestjs/common';

import {
  PARTICIPATION_STORAGE,
  type IParticipationStorage,
  type ParticipationSubjectType,
} from 'src/storage/interfaces/participation-storage.interface';

const SUBJECT_TYPES: ParticipationSubjectType[] = ['TEAM', 'PERSON'];

export function isParticipationSubjectType(value: string): value is ParticipationSubjectType {
  return SUBJECT_TYPES.includes(value as ParticipationSubjectType);
}

@Injectable()
export class ParticipationService {
  constructor(@Inject(PARTICIPATION_STORAGE) private readonly participation: IParticipationStorage) {}

  /**
   * Everything one subject took part in, earliest first.
   *
   * This is a SCHEDULE, not a calendar. A calendar answers "what does this provider own", which a
   * competitor's season is not: half of it is played at someone else's venue, under someone else's
   * ownership. Reading it from the index rather than from records is what keeps it O(rows-for-this-
   * subject) — deriving it would mean loading every tournament the subject appears in, which is the
   * unbounded cross-tournament read A7 forbids on a controller-reachable path.
   */
  async getSchedule({
    subjectType,
    subjectId,
    organisationId,
  }: {
    subjectType: ParticipationSubjectType;
    subjectId: string;
    organisationId?: string;
  }) {
    const entries = await this.participation.listForSubject(subjectType, subjectId, organisationId);
    return { subjectType, subjectId, ...(organisationId ? { organisationId } : {}), count: entries.length, entries };
  }
}
