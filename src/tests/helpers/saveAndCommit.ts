/**
 * Test helper for the async save-validation flow.
 *
 * The /factory/save endpoint returns 202 with saveIds.
 * The validation worker commits asynchronously. In tests,
 * we call /factory/internal/commit-save directly to commit
 * synchronously so subsequent operations can find the data.
 */
import request from 'supertest';

const INTERNAL_KEY = 'test-internal-key';

/**
 * Save a tournament record and immediately commit it.
 * Sets INTERNAL_API_KEY env var if not already set.
 */
export async function saveAndCommit(
  server: any,
  token: string,
  tournamentRecord: any,
): Promise<void> {
  // Ensure INTERNAL_API_KEY is set for commit endpoint
  if (!process.env.INTERNAL_API_KEY) {
    process.env.INTERNAL_API_KEY = INTERNAL_KEY;
  }

  const saveRes = await request(server)
    .post('/factory/save')
    .set('Authorization', `Bearer ${token}`)
    .send({ tournamentRecord })
    .expect(202);

  const saveIds: string[] = saveRes.body.saveIds || [];
  for (const saveId of saveIds) {
    await request(server)
      .post('/factory/internal/commit-save')
      .set('x-internal-key', process.env.INTERNAL_API_KEY)
      .send({ saveId })
      .expect(200);
  }
}
