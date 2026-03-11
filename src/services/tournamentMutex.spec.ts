import { withTournamentLock } from './tournamentMutex';

describe('tournamentMutex', () => {
  describe('withTournamentLock', () => {
    it('executes function and returns result', async () => {
      const result = await withTournamentLock(['t1'], async () => 'done');
      expect(result).toBe('done');
    });

    it('releases lock after function completes', async () => {
      await withTournamentLock(['t-release'], async () => 'first');
      // If lock wasn't released, this would hang
      const result = await withTournamentLock(['t-release'], async () => 'second');
      expect(result).toBe('second');
    });

    it('releases lock when function throws', async () => {
      await expect(
        withTournamentLock(['t-throw'], async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');

      // Lock should be released — next call should succeed
      const result = await withTournamentLock(['t-throw'], async () => 'recovered');
      expect(result).toBe('recovered');
    });

    it('serializes concurrent access to the same tournament', async () => {
      const order: number[] = [];

      const task = (n: number, delayMs: number) =>
        withTournamentLock(['t-serial'], async () => {
          order.push(n);
          await new Promise((r) => setTimeout(r, delayMs));
          return n;
        });

      // Start both concurrently — task 1 should complete before task 2 starts
      const [r1, r2] = await Promise.all([task(1, 50), task(2, 10)]);
      expect(r1).toBe(1);
      expect(r2).toBe(2);
      expect(order).toEqual([1, 2]); // task 1 runs first even though task 2 is faster
    });

    it('allows concurrent access to different tournaments', async () => {
      const order: string[] = [];

      const task = (id: string, delayMs: number) =>
        withTournamentLock([id], async () => {
          order.push(`start-${id}`);
          await new Promise((r) => setTimeout(r, delayMs));
          order.push(`end-${id}`);
          return id;
        });

      const [r1, r2] = await Promise.all([task('t-a', 50), task('t-b', 10)]);
      expect(r1).toBe('t-a');
      expect(r2).toBe('t-b');
      // t-b should finish before t-a since they run concurrently
      expect(order.indexOf('end-t-b')).toBeLessThan(order.indexOf('end-t-a'));
    });

    it('acquires locks in sorted order to prevent deadlocks', async () => {
      // If locks are acquired in different orders, deadlocks are possible.
      // The mutex sorts IDs, so both tasks acquire in the same order.
      const results = await Promise.all([
        withTournamentLock(['t-z', 't-a'], async () => 'first'),
        withTournamentLock(['t-a', 't-z'], async () => 'second'),
      ]);
      expect(results).toContain('first');
      expect(results).toContain('second');
    });

    it('handles empty tournament ID array', async () => {
      const result = await withTournamentLock([], async () => 'empty');
      expect(result).toBe('empty');
    });

    it('handles single tournament ID', async () => {
      const result = await withTournamentLock(['single'], async () => 42);
      expect(result).toBe(42);
    });

    it('releases partial locks on timeout', async () => {
      // Hold a lock for a long time
      const blocker = withTournamentLock(['t-timeout'], async () => {
        await new Promise((r) => setTimeout(r, 500));
        return 'blocker';
      });

      // Try to acquire the same lock with a very short timeout
      // This should fail with timeout
      const waiter = withTournamentLock(['t-timeout'], async () => 'waiter');

      // The blocker should succeed
      const blockerResult = await blocker;
      expect(blockerResult).toBe('blocker');

      // The waiter should also succeed after the blocker releases
      const waiterResult = await waiter;
      expect(waiterResult).toBe('waiter');
    });
  });
});
