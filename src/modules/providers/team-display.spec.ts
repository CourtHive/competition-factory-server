import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TeamDisplayController } from './team-display.controller';
import { PROVIDER_ADMIN } from 'src/common/constants/roles';

const colors = { palette: [{ colorId: 'navy', value: '#13294b' }], display: { roles: { 'team.surface': 'navy' } } };
const admin = { providerRoles: { alpha: PROVIDER_ADMIN } } as any;

it('requires the target provider administrator and rejects malformed data before any SQL', async () => {
  const query = vi.fn();
  const controller = new TeamDisplayController({ query } as any);
  await expect(controller.put('beta', { teamColors: colors }, admin)).rejects.toBeInstanceOf(ForbiddenException);
  await expect(
    controller.put('alpha', { teamColors: { ...colors, display: { roles: { 'team.surface': 'missing' } } } }, admin),
  ).rejects.toBeInstanceOf(BadRequestException);
  await expect(controller.put('alpha', { teamColors: null }, admin)).rejects.toBeInstanceOf(BadRequestException);
  expect(query).not.toHaveBeenCalled();
});
it('writes a normalized full replacement or clear surgically and projects only safe TEAM identity', async () => {
  const query = vi.fn().mockResolvedValue({
    rowCount: 1,
    rows: [{ provider_id: 'alpha', organisation_name: 'Alpha', team_colors: colors, secret: 'hidden' }],
  });
  const controller = new TeamDisplayController({ query } as any);
  await controller.put('alpha', { teamColors: colors }, admin);
  expect(query.mock.calls[0][0]).toContain('jsonb_set');
  expect(JSON.parse(query.mock.calls[0][1][1]).palette[0].value).toBe('#13294B');
  expect(await controller.get('alpha')).toEqual({
    participant: {
      participantId: 'alpha',
      participantName: 'Alpha',
      participantType: 'TEAM',
      participantRole: 'COMPETITOR',
      teamColors: { ...colors, palette: [{ colorId: 'navy', value: '#13294B' }] },
    },
  });
  await controller.put('alpha', { teamColors: {} }, admin);
  expect(query.mock.lastCall?.[0]).toContain("- 'teamColors'");
});

it('bounds directory reads and returns only team identifiers and names', async () => {
  const rows = Array.from({ length: 51 }, (_, index) => ({
    provider_id: `college-${index}`,
    organisation_name: `College ${index}`,
    secret: 'hidden',
  }));
  const query = vi.fn().mockResolvedValue({ rows });
  const controller = new TeamDisplayController({ query } as any);
  const result = await controller.list('College', '50');
  expect(result.teams).toHaveLength(50);
  expect(result.nextOffset).toBe(100);
  expect(query.mock.calls[0][0]).toContain('LIMIT 51');
  expect(query.mock.calls[0][1]).toEqual(['%College%', 'College', 50]);
  expect(JSON.stringify(result)).not.toContain('secret');
  await expect(controller.list('College', '-1')).rejects.toBeInstanceOf(BadRequestException);
});
