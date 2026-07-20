import {
  computeFanOutTargets,
  isLinkGraphMutation,
  isScheduleAffecting,
  venueIdsFromMethods,
  venueIdsFromRecord,
  SCHEDULE_LINK_GRAPH_METHODS,
} from './facility-schedule-broadcast.helpers';

describe('facility-schedule-broadcast.helpers', () => {
  describe('isScheduleAffecting', () => {
    it('is true for methods that map to canModifySchedule', () => {
      expect(isScheduleAffecting(['addMatchUpScheduleItems'])).toBe(true);
      expect(isScheduleAffecting(['bulkScheduleMatchUps'])).toBe(true);
      expect(isScheduleAffecting(['proAutoSchedule'])).toBe(true);
    });

    it('is true for link-graph mutations', () => {
      expect(isScheduleAffecting(['linkTournaments'])).toBe(true);
      expect(isScheduleAffecting(['unlinkTournament'])).toBe(true);
      expect(isScheduleAffecting(['unlinkTournaments'])).toBe(true);
    });

    it('is false for score/status/draw mutations (do not move courts)', () => {
      expect(isScheduleAffecting(['setMatchUpStatus'])).toBe(false);
      expect(isScheduleAffecting(['addDrawDefinition'])).toBe(false);
      expect(isScheduleAffecting(['addParticipants'])).toBe(false);
      expect(isScheduleAffecting([])).toBe(false);
    });

    it('is true when any method in a mixed batch is schedule-affecting', () => {
      expect(isScheduleAffecting(['setMatchUpStatus', 'addMatchUpScheduleItems'])).toBe(true);
    });
  });

  describe('isLinkGraphMutation', () => {
    it('detects link/unlink methods only', () => {
      expect(isLinkGraphMutation(['linkTournaments'])).toBe(true);
      expect(isLinkGraphMutation(['addMatchUpScheduleItems'])).toBe(false);
      expect([...SCHEDULE_LINK_GRAPH_METHODS]).toEqual(['linkTournaments', 'unlinkTournaments', 'unlinkTournament']);
    });
  });

  describe('venueIdsFromMethods', () => {
    it('unions venueId, schedule.venueId, and venueIds[] across methods (deduped)', () => {
      const methods = [
        { method: 'addMatchUpScheduleItems', params: { schedule: { venueId: 'v1' } } },
        { method: 'bulkScheduleMatchUps', params: { venueIds: ['v1', 'v2'] } },
        { method: 'proAutoSchedule', params: { venueId: 'v3' } },
      ];
      expect(venueIdsFromMethods(methods).sort()).toEqual(['v1', 'v2', 'v3']);
    });

    it('returns [] when no venue is referenced', () => {
      expect(venueIdsFromMethods([{ method: 'x', params: {} }])).toEqual([]);
      expect(venueIdsFromMethods([])).toEqual([]);
    });
  });

  describe('venueIdsFromRecord', () => {
    it('maps record.venues → venueIds, dropping falsy', () => {
      expect(venueIdsFromRecord({ venues: [{ venueId: 'v1' }, { venueId: 'v2' }, {}] })).toEqual(['v1', 'v2']);
      expect(venueIdsFromRecord({})).toEqual([]);
    });
  });

  describe('computeFanOutTargets', () => {
    const empty = { linkGraph: false, groupIds: new Set<string>() };

    it('returns stored linked peers, excluding the source', () => {
      const record = { linkedTournamentIds: ['ctx', 'peer-a', 'peer-b'] };
      expect(computeFanOutTargets(record, empty, 'ctx').sort()).toEqual(['peer-a', 'peer-b']);
    });

    it('for a link-graph mutation, also includes the batch group ids (covers unlink vanished peer)', () => {
      // After unlink, the record no longer lists the removed peer — it must still be reached via the batch.
      const record = { linkedTournamentIds: ['ctx'] };
      const pending = { linkGraph: true, groupIds: new Set(['removed-peer']) };
      expect(computeFanOutTargets(record, pending, 'ctx')).toEqual(['removed-peer']);
    });

    it('returns [] when there are no links and no group ids', () => {
      expect(computeFanOutTargets({ linkedTournamentIds: ['ctx'] }, empty, 'ctx')).toEqual([]);
      expect(computeFanOutTargets({}, empty, 'ctx')).toEqual([]);
    });
  });
});
