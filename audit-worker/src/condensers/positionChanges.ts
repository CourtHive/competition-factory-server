import type { AuditRow } from '../db.js';

const POSITION_METHODS = new Set([
  'assignDrawPosition',
  'removeDrawPosition',
  'swapDrawPositionAssignments',
  'alternateDrawPositionAssignment',
  'luckyLoserDrawPositionAssignment',
  'withdrawParticipantAtDrawPosition',
  'automatedPositioning',
]);

export function condensePositionChanges(rows: AuditRow[]) {
  const columns = [
    { key: 'occurredAt', title: 'Timestamp', type: 'date' },
    { key: 'userEmail', title: 'User', type: 'string' },
    { key: 'method', title: 'Action', type: 'string' },
    { key: 'drawId', title: 'Draw', type: 'string' },
    { key: 'drawPosition', title: 'Position', type: 'number' },
    { key: 'description', title: 'Description', type: 'string' },
  ];

  const condensed: any[] = [];

  for (const row of rows) {
    const methods = Array.isArray(row.methods) ? row.methods : [];
    for (const m of methods) {
      if (!POSITION_METHODS.has(m.method)) continue;

      const drawId = m.params?.drawId || '';
      const drawPosition = m.params?.drawPosition ?? m.params?.drawPositions?.[0] ?? '';

      condensed.push({
        occurredAt: row.occurred_at,
        userEmail: row.user_email || '',
        method: m.method,
        drawId,
        drawPosition,
        description: m.method.replace(/([A-Z])/g, ' $1').trim(),
      });
    }
  }

  return { columns, rows: condensed };
}
