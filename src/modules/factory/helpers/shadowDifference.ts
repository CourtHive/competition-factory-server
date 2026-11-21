// Only fixed schema names may appear in paths. Map keys and arbitrary extensions can contain participant data.
const fields = new Set(
  'structures childStructures matchUps tieMatchUps score server player sets winningSide matchUpStatus matchUpType sideNumber sides scoreStringSide1 scoreStringSide2 side1Score side2Score setNumber positionAssignments drawPosition roundNumber roundPosition participantId entries entryStatus extensions value name drawName drawId structureId matchUpId schedule courtId scheduledDate factory'.split(
    ' ',
  ),
);
const statuses = new Set(['COMPLETED', 'TO_BE_PLAYED', 'IN_PROGRESS', 'RETIRED', 'WALKOVER', 'DEFAULTED', 'ABANDONED']);
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function shape(value: Json | undefined, field?: string): string {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array(${value.length})`;
  if (field === 'matchUpStatus' && typeof value === 'string' && statuses.has(value)) return value;
  return typeof value;
}

// Inputs are the same canonical JSON used to decide parity. Parsing and walking happen only on a mismatch.
export function shadowDifferences(saved: string, shadow: string, path: string, limit: number): string[] {
  const found: string[] = [];
  const parse = (text: string): Json | undefined => (text === 'undefined' ? undefined : JSON.parse(text));
  function walk(a: Json | undefined, b: Json | undefined, at: string, field?: string) {
    if (found.length >= limit || a === b) return;
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
      for (let i = 0; i < a.length && found.length < limit; i++) walk(a[i], b[i], `${at}[${i}]`);
    } else if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      const left = Object.keys(a),
        right = Object.keys(b);
      const before = found.length;
      for (const key of new Set([...left, ...right])) {
        if (found.length >= limit) break;
        walk(
          Object.prototype.hasOwnProperty.call(a, key) ? a[key] : undefined,
          Object.prototype.hasOwnProperty.call(b, key) ? b[key] : undefined,
          at + (fields.has(key) ? '.' + key : '.[field]'),
          key,
        );
      }
      if (found.length === before && left.some((key, i) => key !== right[i])) found.push(at + ' field-order');
    } else {
      found.push(`${at} saved=${shape(a, field)} shadow=${shape(b, field)}`);
    }
  }
  walk(parse(saved), parse(shadow), path);
  return found;
}
