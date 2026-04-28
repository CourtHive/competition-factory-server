/**
 * Deterministic PRNG for test fixtures.
 *
 * mocksEngine.generateTournamentRecord (and friends) accept an optional
 * `random: () => number` to drive name/UUID selection. Passing a seeded
 * RNG makes a spec produce the same tournament_id, tournament_name, and
 * draw structure across runs — which means re-running the spec UPSERTs
 * the same Postgres row instead of inserting a fresh UUID each time.
 *
 * Mulberry32 is a tiny, non-cryptographic 32-bit PRNG with good
 * distribution for test seeds. Good enough for fixtures, intentionally
 * not used outside tests.
 */
export function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
