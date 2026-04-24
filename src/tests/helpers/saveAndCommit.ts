/**
 * Test helper for saving tournament records.
 *
 * The /factory/save endpoint saves directly and returns 200.
 */
import request from 'supertest';

/**
 * Save a tournament record via REST.
 */
export async function saveAndCommit(
  server: any,
  token: string,
  tournamentRecord: any,
): Promise<void> {
  await request(server)
    .post('/factory/save')
    .set('Authorization', `Bearer ${token}`)
    .send({ tournamentRecord })
    .expect(200);
}
