import { getPostgresConfig } from 'src/storage/postgres/postgres.config';
import { TeamDisplayController } from './team-display.controller';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

// constants and types
import { PROVIDER_ADMIN } from 'src/common/constants/roles';

describe.skipIf(process.env.STORAGE_PROVIDER !== 'postgres')('provider defaults in durable Postgres storage', () => {
  const providerId = `test-team-display-${randomUUID()}`;
  const pool = new Pool(getPostgresConfig());
  const controller = new TeamDisplayController(pool);
  const ctx = { providerRoles: { [providerId]: PROVIDER_ADMIN } } as any;
  const colors = {
    palette: [
      { colorId: 'navy', value: '#13294b' },
      { colorId: 'white', value: '#ffffff' },
    ],
    display: { roles: { 'team.surface': 'navy', 'team.text': 'white' } },
  };
  beforeAll(async () => {
    await pool.query(
      'INSERT INTO providers (provider_id, organisation_abbreviation, organisation_name, data) VALUES ($1, $2, $3, $4)',
      [providerId, providerId, 'Test College', JSON.stringify({ privateKey: 'not-public', unrelated: { keep: true } })],
    );
  });
  afterAll(async () => {
    await pool.query('DELETE FROM providers WHERE provider_id = $1', [providerId]);
    await pool.end();
  });
  it('persists normalized defaults, exports safe identity and preserves unrelated provider settings on clear', async () => {
    await controller.put(providerId, { teamColors: colors }, ctx);
    const stored = await pool.query('SELECT data FROM providers WHERE provider_id = $1', [providerId]);
    expect(stored.rows[0].data.teamColors.palette[0].value).toBe('#13294B');
    expect(stored.rows[0].data.unrelated).toEqual({ keep: true });
    const exported = await controller.get(providerId);
    expect(exported.participant.participantId).toBe(providerId);
    expect(exported.participant.teamColors?.display?.roles).toEqual(colors.display.roles);
    expect(JSON.stringify(exported)).not.toContain('privateKey');
    await controller.put(providerId, { teamColors: {} }, ctx);
    expect((await controller.get(providerId)).participant).not.toHaveProperty('teamColors');
    const cleared = await pool.query('SELECT data FROM providers WHERE provider_id = $1', [providerId]);
    expect(cleared.rows[0].data.unrelated).toEqual({ keep: true });
  });
});
