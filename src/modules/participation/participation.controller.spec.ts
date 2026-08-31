import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ParticipationController } from './participation.controller';
import { ParticipationService } from './participation.service';

describe('ParticipationController', () => {
  let controller: ParticipationController;
  let storage: any;

  const row = (tournamentId: string, startDate: string) => ({
    subjectType: 'TEAM',
    subjectId: 'team-a',
    tournamentId,
    participantId: `local-${tournamentId}`,
    startDate,
  });

  beforeEach(() => {
    storage = { listForSubject: vi.fn().mockResolvedValue([]), replaceTournamentRows: vi.fn(), deleteTournamentRows: vi.fn() };
    controller = new ParticipationController(new ParticipationService(storage));
  });

  it('returns a subject’s fixtures whoever owned them — the away half of a season', async () => {
    // The reason this route is not a calendar read: these two fixtures are owned by whoever staged
    // them, and a calendar keyed on ownership can only ever return one of the two sides.
    storage.listForSubject.mockResolvedValue([row('dual-1', '2026-02-01'), row('dual-2', '2026-03-01')]);
    const result: any = await controller.getSchedule('TEAM', 'team-a');
    expect(result.count).toBe(2);
    expect(result.entries.map((entry: any) => entry.tournamentId)).toEqual(['dual-1', 'dual-2']);
    expect(storage.listForSubject).toHaveBeenCalledWith('TEAM', 'team-a');
  });

  it('accepts a lower-case subjectType so the route is not case-fragile', async () => {
    await controller.getSchedule('team', 'team-a');
    expect(storage.listForSubject).toHaveBeenCalledWith('TEAM', 'team-a');
  });

  it('REJECTS an unknown subjectType rather than returning an empty schedule', async () => {
    // An empty list for a typo'd grain is indistinguishable from a subject that genuinely competed
    // in nothing, and the caller would render "no fixtures" for a team with a full season.
    await expect(controller.getSchedule('TEAMS', 'team-a')).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.listForSubject).not.toHaveBeenCalled();
  });

  it('returns an empty schedule, not an error, for a subject that competed in nothing', async () => {
    const result: any = await controller.getSchedule('TEAM', 'unknown-team');
    expect(result).toMatchObject({ subjectType: 'TEAM', subjectId: 'unknown-team', count: 0, entries: [] });
  });
});
