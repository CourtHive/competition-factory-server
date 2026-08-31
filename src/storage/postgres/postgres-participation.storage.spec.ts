import { PostgresParticipationStorage } from './postgres-participation.storage';

/** A pooled client whose behaviour per statement is scriptable. */
function makePool(onQuery: (sql: string) => any) {
  const client = {
    query: vi.fn(async (sql: string) => onQuery(sql)),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn().mockResolvedValue(client), query: vi.fn() } as any;
  return { pool, client };
}

const row = (over: any = {}) => ({
  subjectType: 'TEAM' as const,
  subjectId: 'ita-A',
  tournamentId: 'dual-1',
  participantId: 'local-a',
  ...over,
});

describe('PostgresParticipationStorage.replaceTournamentRows', () => {
  it('deletes then inserts inside one transaction, and releases the client', async () => {
    const { pool, client } = makePool(() => ({ rows: [] }));
    await new PostgresParticipationStorage(pool).replaceTournamentRows('dual-1', [row()]);

    const statements = client.query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/)[0]);
    expect(statements).toEqual(['BEGIN', 'DELETE', 'INSERT', 'COMMIT']);
    expect(client.release).toHaveBeenCalled();
  });

  it('surfaces the ORIGINAL error when the connection dies, not the ROLLBACK rejection', async () => {
    // The failure mode this guard exists for, and it is a RACE rather than the routine case: an
    // INFORMATIVE failure, and then the connection dying before the rollback runs. (When the
    // connection dies first, the original is itself the connection error and masking costs
    // nothing — measured.) Here the constraint violation is the root cause and must survive.
    const original = new Error('duplicate key value violates unique constraint');
    const dead = new Error('Client has encountered a connection error and is not queryable');
    const { pool, client } = makePool((sql) => {
      if (sql.startsWith('BEGIN') || sql.startsWith('DELETE')) return { rows: [] };
      if (sql.trim().startsWith('INSERT')) throw original;
      throw dead; // ROLLBACK on a dead client
    });

    await expect(new PostgresParticipationStorage(pool).replaceTournamentRows('dual-1', [row()])).rejects.toBe(original);
    expect(client.release).toHaveBeenCalled();
  });

  it('still rolls back, and still rethrows, on an ordinary failure', async () => {
    const original = new Error('constraint');
    const { pool, client } = makePool((sql) => {
      if (sql.trim().startsWith('INSERT')) throw original;
      return { rows: [] };
    });

    await expect(new PostgresParticipationStorage(pool).replaceTournamentRows('dual-1', [row()])).rejects.toBe(original);
    expect(client.query.mock.calls.map(([sql]) => String(sql).trim())).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  it('replaces with an EMPTY set, so a tournament losing its competitors loses its rows', async () => {
    const { pool, client } = makePool(() => ({ rows: [] }));
    await new PostgresParticipationStorage(pool).replaceTournamentRows('dual-1', []);
    const statements = client.query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/)[0]);
    expect(statements).toEqual(['BEGIN', 'DELETE', 'COMMIT']);
  });
});
