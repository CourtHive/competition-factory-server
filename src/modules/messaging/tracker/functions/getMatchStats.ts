import { mo } from './umo';

export function getMatchStats(source) {
  const match = mo.Match();
  match.addPoints(source.points);
  return match.stats.calculated();
}
